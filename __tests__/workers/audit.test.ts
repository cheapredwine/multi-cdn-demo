import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { handleAudit } from "../../src/workers/audit";
import "../../src/types";

describe("audit Worker", () => {
	it("returns 200 HTML", async () => {
		const res = handleAudit(new Request("https://audit.demo.example.com/"), env);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/html");
	});

	it("injects the runtime DOMAIN into the API_BASE script", async () => {
		const res = handleAudit(new Request("https://audit.demo.example.com/"), env);
		const body = await res.text();
		expect(body).toContain("https://secure.demo.example.com");
		expect(body).not.toContain("demo.jsherron.com");
	});

	it("contains the audit table", async () => {
		const res = handleAudit(new Request("https://audit.demo.example.com/"), env);
		const body = await res.text();
		expect(body).toContain("Audit Log — Live");
		expect(body).toContain("Polling every 2s");
	});
});
