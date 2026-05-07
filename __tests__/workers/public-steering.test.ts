import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../../src/types";
import { handlePublicSteering } from "../../src/workers/public-steering";

const FIXTURE_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FIXTURE_MP4 = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);

async function seedR2(): Promise<void> {
	// Defensive: wipe any meter/ leftovers that may persist across tests via ctx.waitUntil.
	const stale = await env.BUCKET.list({ prefix: "meter/" });
	for (const obj of stale.objects) {
		await env.BUCKET.delete(obj.key);
	}
	await env.BUCKET.put("public/images/logo.png", FIXTURE_PNG, {
		httpMetadata: { contentType: "image/png" },
	});
	await env.BUCKET.put("public/video/welcome.mp4", FIXTURE_MP4, {
		httpMetadata: { contentType: "video/mp4" },
	});
}

function envWith(overrides: Partial<Env>): Env {
	return { ...env, ...overrides };
}

describe("handlePublicSteering — passthrough mode", () => {
	beforeEach(async () => {
		await seedR2();
	});

	it("serves an existing R2 object with served-by: cf-edge", async () => {
		const e = envWith({ STEERING_MODE: "passthrough" });
		const ctx = createExecutionContext();
		const res = await handlePublicSteering(
			new Request("https://cf-pool.demo.example.com/images/logo.png"),
			e,
			ctx
		);
		await waitOnExecutionContext(ctx);

		expect(res.status).toBe(200);
		expect(res.headers.get("served-by")).toBe("cf-edge");
		const body = new Uint8Array(await res.arrayBuffer());
		expect(body).toEqual(FIXTURE_PNG);
	});

	it("normalizes paths missing the public/ prefix", async () => {
		const e = envWith({ STEERING_MODE: "passthrough" });
		const ctx = createExecutionContext();
		const res = await handlePublicSteering(
			new Request("https://cf-pool.demo.example.com/public/images/logo.png"),
			e,
			ctx
		);
		await waitOnExecutionContext(ctx);
		expect(res.status).toBe(200);
	});

	it("returns 404 when the R2 key does not exist", async () => {
		const e = envWith({ STEERING_MODE: "passthrough" });
		const ctx = createExecutionContext();
		const res = await handlePublicSteering(
			new Request("https://cf-pool.demo.example.com/images/missing.png"),
			e,
			ctx
		);
		await waitOnExecutionContext(ctx);
		expect(res.status).toBe(404);
	});

	it("defaults to passthrough when STEERING_MODE is empty", async () => {
		const e = envWith({ STEERING_MODE: "" });
		const ctx = createExecutionContext();
		const res = await handlePublicSteering(
			new Request("https://cf-pool.demo.example.com/images/logo.png"),
			e,
			ctx
		);
		await waitOnExecutionContext(ctx);
		expect(res.status).toBe(200);
		expect(res.headers.get("served-by")).toBe("cf-edge");
	});

	it("increments the bytes counter via ctx.waitUntil", async () => {
		const e = envWith({ STEERING_MODE: "passthrough" });
		const ctx = createExecutionContext();
		await handlePublicSteering(
			new Request("https://cf-pool.demo.example.com/images/logo.png"),
			e,
			ctx
		);
		await waitOnExecutionContext(ctx);

		const list = await env.BUCKET.list({ prefix: "meter/bytes-hour-" });
		expect(list.objects.length).toBe(1);
		const first = list.objects[0];
		if (!first) throw new Error("counter key missing after increment");
		const counterObj = await env.BUCKET.get(first.key);
		const counter = JSON.parse(await (counterObj as R2ObjectBody).text());
		expect(counter.bytes).toBe(FIXTURE_PNG.length);
	});
});

describe("handlePublicSteering — path_routing mode", () => {
	beforeEach(async () => {
		await seedR2();
	});

	it("serves /video/* from R2 with routing-decision header", async () => {
		const e = envWith({ STEERING_MODE: "path_routing" });
		const ctx = createExecutionContext();
		const res = await handlePublicSteering(
			new Request("https://cf-pool.demo.example.com/video/welcome.mp4"),
			e,
			ctx
		);
		await waitOnExecutionContext(ctx);

		expect(res.status).toBe(200);
		expect(res.headers.get("served-by")).toBe("cf-edge");
		expect(res.headers.get("routing-decision")).toBe("video-locked-to-cf");
	});

	it("302-redirects non-video paths to the CloudFront pool", async () => {
		const e = envWith({ STEERING_MODE: "path_routing" });
		const ctx = createExecutionContext();
		const res = await handlePublicSteering(
			new Request("https://cf-pool.demo.example.com/images/logo.png"),
			e,
			ctx
		);
		await waitOnExecutionContext(ctx);

		expect(res.status).toBe(302);
		expect(res.headers.get("location")).toBe(
			"https://cloudfront-pool.demo.jsherron.com/images/logo.png"
		);
	});

	it("returns 404 when the video path does not exist in R2", async () => {
		const e = envWith({ STEERING_MODE: "path_routing" });
		const ctx = createExecutionContext();
		const res = await handlePublicSteering(
			new Request("https://cf-pool.demo.example.com/video/missing.mp4"),
			e,
			ctx
		);
		await waitOnExecutionContext(ctx);
		expect(res.status).toBe(404);
	});
});

describe("handlePublicSteering — percent_rollout mode", () => {
	beforeEach(async () => {
		await seedR2();
	});

	it("serves from R2 when ROLLOUT_PCT is 100", async () => {
		const e = envWith({ STEERING_MODE: "percent_rollout", ROLLOUT_PCT: "100" });
		const ctx = createExecutionContext();
		const res = await handlePublicSteering(
			new Request("https://cf-pool.demo.example.com/images/logo.png"),
			e,
			ctx
		);
		await waitOnExecutionContext(ctx);
		expect(res.status).toBe(200);
		expect(res.headers.get("served-by")).toBe("cf-edge");
		expect(res.headers.get("routing-decision")).toBe("rollout-cf");
	});

	it("redirects to CloudFront when ROLLOUT_PCT is 0", async () => {
		const e = envWith({ STEERING_MODE: "percent_rollout", ROLLOUT_PCT: "0" });
		const ctx = createExecutionContext();
		const res = await handlePublicSteering(
			new Request("https://cf-pool.demo.example.com/images/logo.png"),
			e,
			ctx
		);
		await waitOnExecutionContext(ctx);
		expect(res.status).toBe(302);
		expect(res.headers.get("location")).toBe(
			"https://cloudfront-pool.demo.jsherron.com/images/logo.png"
		);
	});

	it("treats missing ROLLOUT_PCT as 0 (all redirects)", async () => {
		const e = envWith({ STEERING_MODE: "percent_rollout", ROLLOUT_PCT: "" });
		const ctx = createExecutionContext();
		const res = await handlePublicSteering(
			new Request("https://cf-pool.demo.example.com/images/logo.png"),
			e,
			ctx
		);
		await waitOnExecutionContext(ctx);
		expect(res.status).toBe(302);
	});
});

describe("handlePublicSteering — unknown mode", () => {
	it("returns 500 for an unrecognized STEERING_MODE", async () => {
		const e = envWith({ STEERING_MODE: "nonsense" });
		const ctx = createExecutionContext();
		const res = await handlePublicSteering(
			new Request("https://cf-pool.demo.example.com/images/logo.png"),
			e,
			ctx
		);
		await waitOnExecutionContext(ctx);
		expect(res.status).toBe(500);
	});
});
