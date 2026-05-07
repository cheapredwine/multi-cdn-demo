/**
 * Secure content Worker.
 *
 * Handles:
 * - POST /issue — mint JWTs for protected content
 * - GET /private/* — serve protected content with JWT validation
 * - GET /audit/recent — read audit log entries (from R2)
 */

import { incrementBytesServed } from "../../lib/meter";
import type { Env } from "../../types";

const TOKEN_TTL_SECONDS = 60;
const AUDIT_PREFIX = "audit/";

/**
 * Generate a simple UUID v4.
 */
function uuid(): string {
	return crypto.randomUUID();
}

/**
 * Base64URL encode without padding.
 */
function b64url(input: Uint8Array): string {
	const base64 = btoa(String.fromCharCode(...input));
	return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Sign a JWT with HS256.
 */
async function signJwt(payload: Record<string, unknown>, secret: string): Promise<string> {
	const header = { alg: "HS256", typ: "JWT" };
	const enc = new TextEncoder();
	const headerB64 = b64url(enc.encode(JSON.stringify(header)));
	const payloadB64 = b64url(enc.encode(JSON.stringify(payload)));
	const signingInput = `${headerB64}.${payloadB64}`;

	const key = await crypto.subtle.importKey(
		"raw",
		enc.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"]
	);
	const signature = await crypto.subtle.sign("HMAC", key, enc.encode(signingInput));
	const sigB64 = b64url(new Uint8Array(signature));

	return `${signingInput}.${sigB64}`;
}

/**
 * Verify a JWT with HS256.
 */
async function verifyJwt(token: string, secret: string): Promise<Record<string, unknown> | null> {
	const [headerB64, payloadB64, sigB64] = token.split(".");
	if (!headerB64 || !payloadB64 || !sigB64) return null;

	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		enc.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["verify"]
	);

	const signingInput = `${headerB64}.${payloadB64}`;
	const sigBase64 = sigB64.replace(/-/g, "+").replace(/_/g, "/");
	const sigPadding = "=".repeat((4 - (sigBase64.length % 4)) % 4);
	const sig = Uint8Array.from(atob(sigBase64 + sigPadding), (c) => c.charCodeAt(0));

	const valid = await crypto.subtle.verify("HMAC", key, sig, enc.encode(signingInput));
	if (!valid) return null;

	const payloadBase64 = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
	const payloadPadding = "=".repeat((4 - (payloadBase64.length % 4)) % 4);
	const payloadJson = atob(payloadBase64 + payloadPadding);
	try {
		return JSON.parse(payloadJson) as Record<string, unknown>;
	} catch {
		return null;
	}
}

/**
 * Write an audit entry to R2.
 */
async function writeAudit(
	env: Env,
	decision: "allow" | "deny",
	details: Record<string, string>
): Promise<void> {
	const ts = Date.now();
	const jti = details.jti || uuid();
	// Reverse timestamp for newest-first listing
	const key = `${AUDIT_PREFIX}${String(1e15 - ts).padStart(16, "0")}-${jti}.json`;
	const value = JSON.stringify({ ts, decision, ...details });
	await env.BUCKET.put(key, value, {
		httpMetadata: { contentType: "application/json" },
	});
}

/**
 * Read recent audit entries from R2.
 */
async function readAudit(env: Env, limit = 50): Promise<Record<string, unknown>[]> {
	const list = await env.BUCKET.list({ prefix: AUDIT_PREFIX, limit });
	const entries: Record<string, unknown>[] = [];
	for (const obj of list.objects) {
		const item = await env.BUCKET.get(obj.key);
		if (item) {
			const text = await item.text();
			entries.push(JSON.parse(text));
		}
	}
	return entries;
}

// ── Handlers ──────────────────────────────────────────────────────

async function handleIssue(request: Request, env: Env): Promise<Response> {
	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		body = {
			subject: "patient-demo",
			path_prefix: "private/docs/",
		};
	}

	const subject = String(body.subject || "patient-demo");
	const pathPrefix = String(body.path_prefix || "private/docs/");
	const now = Math.floor(Date.now() / 1000);
	const jti = uuid();

	const payload = {
		sub: subject,
		path_prefix: pathPrefix,
		iat: now,
		exp: now + TOKEN_TTL_SECONDS,
		jti,
	};

	const token = await signJwt(payload, env.JWT_SECRET);
	const expiresAt = new Date((now + TOKEN_TTL_SECONDS) * 1000).toISOString();

	return Response.json({
		token,
		url: `https://secure.demo.jsherron.com/private/docs/after-visit-summary-sample.pdf?token=${token}`,
		expires_at: expiresAt,
	});
}

async function handlePrivate(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const url = new URL(request.url);
	const token = url.searchParams.get("token");
	const clientIp = request.headers.get("cf-connecting-ip") || "unknown";

	if (!token) {
		await writeAudit(env, "deny", {
			reason: "missing_token",
			path: url.pathname,
			ip: clientIp,
			jti: "",
		});
		return Response.json({ error: "missing_token" }, { status: 403 });
	}

	const payload = await verifyJwt(token, env.JWT_SECRET);
	if (!payload) {
		await writeAudit(env, "deny", {
			reason: "invalid_signature",
			path: url.pathname,
			ip: clientIp,
			jti: "",
		});
		return Response.json({ error: "invalid_signature" }, { status: 403 });
	}

	const now = Math.floor(Date.now() / 1000);
	const exp = Number(payload.exp);
	if (Number.isNaN(exp) || now > exp) {
		const jti = String(payload.jti || "");
		await writeAudit(env, "deny", {
			reason: "expired",
			path: url.pathname,
			ip: clientIp,
			jti,
			sub: String(payload.sub || ""),
		});
		return Response.json({ error: "expired" }, { status: 403 });
	}

	const pathPrefix = String(payload.path_prefix || "");
	const requestedPath = url.pathname.replace(/^\//, "");
	if (!requestedPath.startsWith(pathPrefix)) {
		const jti = String(payload.jti || "");
		await writeAudit(env, "deny", {
			reason: "scope_mismatch",
			path: url.pathname,
			ip: clientIp,
			jti,
			sub: String(payload.sub || ""),
		});
		return Response.json({ error: "scope_mismatch" }, { status: 403 });
	}

	const object = await env.BUCKET.get(requestedPath);
	if (!object) {
		return new Response("Not found", { status: 404 });
	}

	const jti = String(payload.jti || "");
	const sub = String(payload.sub || "");
	await writeAudit(env, "allow", { path: url.pathname, ip: clientIp, jti, sub });
	ctx.waitUntil(incrementBytesServed(env, object.size));

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set("etag", object.httpEtag);
	return new Response(object.body, { headers });
}

async function handleAuditRecent(_request: Request, env: Env): Promise<Response> {
	const entries = await readAudit(env, 50);
	return Response.json(entries);
}

/**
 * CORS headers for the demo.
 *
 * Open to `*` because the portal/audit Pages sites are different origins from
 * `secure.demo.jsherron.com` and the demo is intentionally unauthenticated at
 * the network edge. In production this stack runs behind Cloudflare Access,
 * which handles cross-origin auth; CORS would tighten to known origins.
 */
const CORS_HEADERS: Record<string, string> = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
	"Access-Control-Max-Age": "86400",
};

/**
 * Add CORS headers to a Response without mutating the original.
 */
function withCors(response: Response): Response {
	const headers = new Headers(response.headers);
	for (const [k, v] of Object.entries(CORS_HEADERS)) {
		headers.set(k, v);
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export async function handleSecure(
	request: Request,
	env: Env,
	ctx: ExecutionContext
): Promise<Response> {
	// Preflight
	if (request.method === "OPTIONS") {
		return new Response(null, { status: 204, headers: CORS_HEADERS });
	}

	const url = new URL(request.url);

	if (url.pathname === "/issue" && request.method === "POST") {
		return withCors(await handleIssue(request, env));
	}

	if (url.pathname === "/audit/recent" && request.method === "GET") {
		return withCors(await handleAuditRecent(request, env));
	}

	if (url.pathname.startsWith("/private/") && request.method === "GET") {
		// /private/* is consumed by direct browser navigation (URL clicks), so it
		// does not require CORS — but adding the header is harmless for the demo.
		return withCors(await handlePrivate(request, env, ctx));
	}

	return withCors(new Response("Not found", { status: 404 }));
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return handleSecure(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
