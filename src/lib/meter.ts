/**
 * Egress meter helpers.
 *
 * Persists a per-hour bytes-served counter to R2 at `meter/bytes-hour-{YYYY-MM-DD-HH}.json`.
 * Read by `src/workers/meter` to render the live meter UI.
 *
 * The build manual specifies a KV-backed counter; this project moved to R2 because
 * KV write perms were not available on the demo account (see RESTART.md). For demo
 * scale, R2 is fine. The increment is intentionally non-atomic — concurrent writes
 * may lose a few bytes. Documented as acceptable in the manual.
 */

import type { Env } from "../types";

const BYTES_KEY_PREFIX = "meter/bytes-hour-";

/**
 * Compute the R2 key for the current UTC hour's bytes counter.
 *
 * @returns R2 key in the form `meter/bytes-hour-YYYY-MM-DD-HH.json`
 */
export function currentHourKey(): string {
	const now = new Date();
	const y = now.getUTCFullYear();
	const m = String(now.getUTCMonth() + 1).padStart(2, "0");
	const d = String(now.getUTCDate()).padStart(2, "0");
	const h = String(now.getUTCHours()).padStart(2, "0");
	return `${BYTES_KEY_PREFIX}${y}-${m}-${d}-${h}.json`;
}

/**
 * Add `bytes` to the current-hour counter in R2.
 *
 * Best-effort: if read or write fails, swallows the error so it can't break the
 * served response. Caller should invoke via `ctx.waitUntil()` to keep the write
 * off the critical path.
 *
 * @param env - Worker environment with R2 binding
 * @param bytes - byte count to add (skips no-op for non-positive values)
 */
export async function incrementBytesServed(env: Env, bytes: number): Promise<void> {
	if (!Number.isFinite(bytes) || bytes <= 0) return;
	const key = currentHourKey();
	try {
		const existing = await env.BUCKET.get(key);
		let current = 0;
		if (existing) {
			const text = await existing.text();
			current = Number(JSON.parse(text).bytes) || 0;
		}
		const next = current + Math.floor(bytes);
		await env.BUCKET.put(key, JSON.stringify({ bytes: next }), {
			httpMetadata: { contentType: "application/json" },
		});
	} catch {
		// Best-effort. Meter inaccuracy is preferable to user-visible failures.
	}
}
