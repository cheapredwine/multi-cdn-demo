/**
 * Default Worker entry point (template stub).
 *
 * The deployed Workers for this demo live under src/workers/{public-steering,secure,meter}.
 * Each has its own wrangler.<name>.toml. This file is only used by `wrangler.toml`
 * (the dev/test config wired into vitest) and is intentionally a no-op 404 router.
 */

import type { Env } from "./types";

export default {
	async fetch(_request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
		// TODO: Add routes here
		// Example:
		// const url = new URL(_request.url);
		// if (url.pathname === "/health" && request.method === "GET") {
		//   return new Response("ok");
		// }

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
