import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { handlePortal } from "../../src/workers/portal";
import "../../src/types";

describe("portal Worker", () => {
	it("returns 200 HTML", async () => {
		const res = handlePortal(new Request("https://portal.demo.example.com/"), env);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/html");
	});

	it("injects the runtime DOMAIN into the API_BASE script", async () => {
		const res = handlePortal(new Request("https://portal.demo.example.com/"), env);
		const body = await res.text();
		expect(body).toContain("https://secure.demo.example.com");
		expect(body).not.toContain("demo.jsherron.com");
	});

	it("contains the generate button", async () => {
		const res = handlePortal(new Request("https://portal.demo.example.com/"), env);
		const body = await res.text();
		expect(body).toContain("Generate 60-second link to After-Visit Summary");
	});
});
