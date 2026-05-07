import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { currentHourKey, incrementBytesServed } from "../../src/lib/meter";
import "../../src/types";

describe("currentHourKey", () => {
	it("produces a key in the form meter/bytes-hour-YYYY-MM-DD-HH.json", () => {
		const key = currentHourKey();
		expect(key).toMatch(/^meter\/bytes-hour-\d{4}-\d{2}-\d{2}-\d{2}\.json$/);
	});

	it("uses UTC components, not local time", () => {
		const key = currentHourKey();
		const now = new Date();
		const expected = `meter/bytes-hour-${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}-${String(now.getUTCHours()).padStart(2, "0")}.json`;
		expect(key).toBe(expected);
	});
});

describe("incrementBytesServed", () => {
	beforeEach(async () => {
		// isolated R2 between tests, but explicit clean for clarity
		const list = await env.BUCKET.list({ prefix: "meter/" });
		for (const obj of list.objects) {
			await env.BUCKET.delete(obj.key);
		}
	});

	it("creates the counter at the current hour key when none exists", async () => {
		await incrementBytesServed(env, 1024);
		const obj = await env.BUCKET.get(currentHourKey());
		expect(obj).not.toBeNull();
		const body = JSON.parse(await (obj as R2ObjectBody).text());
		expect(body.bytes).toBe(1024);
	});

	it("adds to an existing counter", async () => {
		await incrementBytesServed(env, 100);
		await incrementBytesServed(env, 250);
		const obj = await env.BUCKET.get(currentHourKey());
		const body = JSON.parse(await (obj as R2ObjectBody).text());
		expect(body.bytes).toBe(350);
	});

	it("floors fractional byte counts", async () => {
		await incrementBytesServed(env, 1024.7);
		const obj = await env.BUCKET.get(currentHourKey());
		const body = JSON.parse(await (obj as R2ObjectBody).text());
		expect(body.bytes).toBe(1024);
	});

	it("is a no-op for zero bytes", async () => {
		await incrementBytesServed(env, 0);
		const obj = await env.BUCKET.get(currentHourKey());
		expect(obj).toBeNull();
	});

	it("is a no-op for negative bytes", async () => {
		await incrementBytesServed(env, -5);
		const obj = await env.BUCKET.get(currentHourKey());
		expect(obj).toBeNull();
	});

	it("is a no-op for non-finite bytes", async () => {
		await incrementBytesServed(env, Number.NaN);
		await incrementBytesServed(env, Number.POSITIVE_INFINITY);
		const obj = await env.BUCKET.get(currentHourKey());
		expect(obj).toBeNull();
	});
});
