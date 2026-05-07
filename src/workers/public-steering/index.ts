/**
 * Public steering Worker.
 *
 * Sits in front of the Cloudflare CDN pool. Three steering modes:
 * - passthrough: serve directly from R2, inject `served-by: cf-edge`
 * - path_routing: `/video/*` served from R2 (cf-edge); other paths 302 to CloudFront
 * - percent_rollout: ROLLOUT_PCT% served from R2; rest 302 to CloudFront
 *
 * In path_routing mode, the redirect to CloudFront for non-video paths is the
 * mechanism that makes "video locked to CF" substantively true (not just a
 * response header). Demo curl loops on `/video/*` show only `served-by: cf-edge`;
 * loops on `/images/*` show 302s with Location pointing at the CloudFront pool.
 */

const CLOUDFRONT_POOL_HOSTNAME = "cloudfront-pool.demo.jsherron.com";

import { incrementBytesServed } from "../../lib/meter";
import type { Env } from "../../types";

const MODE_PASSTHROUGH = "passthrough";
const MODE_PATH_ROUTING = "path_routing";
const MODE_PERCENT_ROLLOUT = "percent_rollout";

/**
 * Normalize incoming path to R2 object key.
 * Strips leading `/` and ensures `public/` prefix.
 *
 * @param pathname - raw request pathname
 * @returns R2 object key
 */
function normalizePath(pathname: string): string {
	const trimmed = pathname.replace(/^\//, "");
	if (trimmed.startsWith("public/")) {
		return trimmed;
	}
	return `public/${trimmed}`;
}

/**
 * Serve an object from the R2 bucket and meter the bytes served.
 *
 * @param env - Worker env with R2 binding
 * @param ctx - execution context, used to defer the meter write off the critical path
 * @param key - R2 object key
 * @param extraHeaders - additional response headers
 * @returns Response or null if not found
 */
async function serveFromR2(
	env: Env,
	ctx: ExecutionContext,
	key: string,
	extraHeaders: Record<string, string> = {}
): Promise<Response | null> {
	const object = await env.BUCKET.get(key);
	if (!object) {
		return null;
	}

	ctx.waitUntil(incrementBytesServed(env, object.size));

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set("etag", object.httpEtag);
	headers.set("served-by", "cf-edge");
	for (const [k, v] of Object.entries(extraHeaders)) {
		headers.set(k, v);
	}

	return new Response(object.body, { headers });
}

/**
 * Main fetch handler.
 *
 * @param request - incoming request
 * @param env - Worker environment
 * @param ctx - execution context (used for deferred meter writes)
 * @returns Response
 */
export async function handlePublicSteering(
	request: Request,
	env: Env,
	ctx: ExecutionContext
): Promise<Response> {
	const url = new URL(request.url);
	const mode = env.STEERING_MODE || MODE_PASSTHROUGH;

	// Passthrough mode: serve everything from R2
	if (mode === MODE_PASSTHROUGH) {
		const key = normalizePath(url.pathname);
		const resp = await serveFromR2(env, ctx, key);
		if (resp) return resp;
		return new Response("Not found", { status: 404 });
	}

	// Path routing mode: video served from R2 (CF pool), everything else 302→CloudFront
	if (mode === MODE_PATH_ROUTING) {
		if (url.pathname.startsWith("/video/")) {
			const key = normalizePath(url.pathname);
			const resp = await serveFromR2(env, ctx, key, {
				"routing-decision": "video-locked-to-cf",
			});
			if (resp) return resp;
			return new Response("Not found", { status: 404 });
		}
		// Non-video paths get redirected to CloudFront so the steering decision
		// is actually behavioral, not just a response-header label.
		const cfUrl = `https://${CLOUDFRONT_POOL_HOSTNAME}${url.pathname}`;
		return Response.redirect(cfUrl, 302);
	}

	// Percent rollout mode: randomly redirect some traffic to CloudFront
	if (mode === MODE_PERCENT_ROLLOUT) {
		const pct = Number.parseInt(env.ROLLOUT_PCT || "0", 10);
		const roll = Math.floor(Math.random() * 100);
		if (roll < pct) {
			// Serve from R2 via this Worker
			const key = normalizePath(url.pathname);
			const resp = await serveFromR2(env, ctx, key, {
				"routing-decision": "rollout-cf",
			});
			if (resp) return resp;
			return new Response("Not found", { status: 404 });
		}
		// Redirect to CloudFront
		const cfUrl = `https://${CLOUDFRONT_POOL_HOSTNAME}${url.pathname}`;
		return Response.redirect(cfUrl, 302);
	}

	return new Response("Unknown steering mode", { status: 500 });
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return handlePublicSteering(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
