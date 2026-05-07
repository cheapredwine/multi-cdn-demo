import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { currentHourKey } from "../../src/lib/meter";
import { handleMeter } from "../../src/workers/meter";
import "../../src/types";

async function call(url: string): Promise<Response> {
	return handleMeter(new Request(url), env);
}

describe("handleMeter", () => {
	beforeEach(async () => {
		const list = await env.BUCKET.list({ prefix: "meter/" });
		for (const obj of list.objects) {
			await env.BUCKET.delete(obj.key);
		}
	});

	it("returns 200 HTML at the root", async () => {
		const res = await call("https://meter.demo.example.com/");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/html");
	});

	it("renders the $0.00 headline regardless of traffic", async () => {
		const res = await call("https://meter.demo.example.com/");
		const body = await res.text();
		expect(body).toContain("$0.00");
		expect(body).toContain("Origin egress charges, this hour, real traffic");
	});

	it("shows the 'run some traffic' empty state when bytes counter is missing", async () => {
		const res = await call("https://meter.demo.example.com/");
		const body = await res.text();
		expect(body).toContain("Run some traffic to see comparisons");
	});

	it("renders the comparison table once the counter is populated", async () => {
		await env.BUCKET.put(currentHourKey(), JSON.stringify({ bytes: 5_000_000 }));
		const res = await call("https://meter.demo.example.com/");
		const body = await res.text();
		expect(body).not.toContain("Run some traffic to see comparisons");
		expect(body).toContain("AWS S3 egress");
		expect(body).toContain("Cloudflare R2");
	});

	it("inflates the displayed total when ?demo_seed=N is present", async () => {
		const res = await call("https://meter.demo.example.com/?demo_seed=10");
		const body = await res.text();
		// 10 GB of seed bytes; formatGB renders to .toFixed(2)
		expect(body).toContain("10.00 GB");
	});

	it("renders the static hospital-volume scenarios regardless of bytes", async () => {
		const res = await call("https://meter.demo.example.com/");
		const body = await res.text();
		expect(body).toContain("10 TB/month");
		expect(body).toContain("100 TB/month");
		expect(body).toContain("500 TB/month");
		expect(body).toContain("regional health network");
	});
});
