import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { handleSecure } from "../../src/workers/secure";
import "../../src/types";

const FIXTURE_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"
const PRIVATE_KEY = "private/docs/after-visit-summary-sample.pdf";
const TEST_SECRET = "test-jwt-secret-do-not-use-in-prod";

/**
 * Local HS256 signer that mirrors the secure Worker's internal signJwt.
 * Exists so tests can mint tokens with arbitrary claims (expired, wrong scope, etc.).
 */
async function signTestJwt(
	payload: Record<string, unknown>,
	secret = TEST_SECRET
): Promise<string> {
	const enc = new TextEncoder();
	const b64url = (input: Uint8Array): string =>
		btoa(String.fromCharCode(...input))
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/, "");
	const header = { alg: "HS256", typ: "JWT" };
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
	return `${signingInput}.${b64url(new Uint8Array(signature))}`;
}

async function seedR2(): Promise<void> {
	await env.BUCKET.put(PRIVATE_KEY, FIXTURE_PDF, {
		httpMetadata: { contentType: "application/pdf" },
	});
}

async function call(req: Request): Promise<Response> {
	const ctx = createExecutionContext();
	const res = await handleSecure(req, env, ctx);
	await waitOnExecutionContext(ctx);
	return res;
}

beforeEach(async () => {
	// Wipe persisted state across tests. vitest-pool-workers 0.16 does not
	// reset miniflare R2 between tests by default, so audit/meter logs would
	// otherwise accumulate.
	for (const prefix of ["audit/", "meter/", "private/"]) {
		const list = await env.BUCKET.list({ prefix });
		for (const obj of list.objects) {
			await env.BUCKET.delete(obj.key);
		}
	}
});

describe("handleSecure — CORS", () => {
	it("answers OPTIONS preflight with 204 + CORS headers", async () => {
		const res = await call(
			new Request("https://secure.demo.example.com/issue", { method: "OPTIONS" })
		);
		expect(res.status).toBe(204);
		expect(res.headers.get("access-control-allow-origin")).toBe("*");
		expect(res.headers.get("access-control-allow-methods")).toContain("POST");
	});

	it("attaches CORS headers to non-OPTIONS responses", async () => {
		const res = await call(
			new Request("https://secure.demo.example.com/audit/recent", { method: "GET" })
		);
		expect(res.headers.get("access-control-allow-origin")).toBe("*");
	});

	it("attaches CORS headers to 404 responses", async () => {
		const res = await call(new Request("https://secure.demo.example.com/nope"));
		expect(res.status).toBe(404);
		expect(res.headers.get("access-control-allow-origin")).toBe("*");
	});
});

describe("handleSecure — POST /issue", () => {
	it("returns a token, url, and ISO expires_at", async () => {
		const res = await call(
			new Request("https://secure.demo.example.com/issue", { method: "POST" })
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { token: string; url: string; expires_at: string };
		expect(body.token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
		expect(body.url).toContain("token=");
		expect(new Date(body.expires_at).getTime()).toBeGreaterThan(Date.now());
	});

	it("accepts a custom subject and path_prefix in the JSON body", async () => {
		const res = await call(
			new Request("https://secure.demo.example.com/issue", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ subject: "patient-99", path_prefix: "private/patient-99/" }),
			})
		);
		const body = (await res.json()) as { token: string };
		// Decode the payload and verify the claims round-tripped.
		const payloadB64 = body.token.split(".")[1] ?? "";
		const padded = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
		const padding = "=".repeat((4 - (padded.length % 4)) % 4);
		const claims = JSON.parse(atob(padded + padding)) as Record<string, unknown>;
		expect(claims.sub).toBe("patient-99");
		expect(claims.path_prefix).toBe("private/patient-99/");
	});
});

describe("handleSecure — GET /private/*", () => {
	beforeEach(async () => {
		await seedR2();
	});

	it("returns 200 with the R2 object for a valid in-scope token", async () => {
		const now = Math.floor(Date.now() / 1000);
		const token = await signTestJwt({
			sub: "patient-demo",
			path_prefix: "private/docs/",
			iat: now,
			exp: now + 60,
			jti: "test-jti-1",
		});
		const res = await call(
			new Request(`https://secure.demo.example.com/${PRIVATE_KEY}?token=${token}`)
		);
		expect(res.status).toBe(200);
		const body = new Uint8Array(await res.arrayBuffer());
		expect(body).toEqual(FIXTURE_PDF);
	});

	it("denies missing token (403 missing_token) and writes a deny audit", async () => {
		const res = await call(new Request(`https://secure.demo.example.com/${PRIVATE_KEY}`));
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("missing_token");

		const audit = await env.BUCKET.list({ prefix: "audit/" });
		expect(audit.objects.length).toBeGreaterThan(0);
		const latest = audit.objects[0];
		if (!latest) throw new Error("audit entry missing");
		const obj = await env.BUCKET.get(latest.key);
		const entry = JSON.parse(await (obj as R2ObjectBody).text());
		expect(entry.decision).toBe("deny");
		expect(entry.reason).toBe("missing_token");
	});

	it("denies a tampered signature (403 invalid_signature)", async () => {
		const token = await signTestJwt({
			sub: "x",
			path_prefix: "private/docs/",
			iat: 1,
			exp: 9_999_999_999,
			jti: "j",
		});
		const tampered = `${token.slice(0, -4)}AAAA`;
		const res = await call(
			new Request(`https://secure.demo.example.com/${PRIVATE_KEY}?token=${tampered}`)
		);
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("invalid_signature");
	});

	it("denies a token signed with a different secret (403 invalid_signature)", async () => {
		const now = Math.floor(Date.now() / 1000);
		const token = await signTestJwt(
			{ sub: "x", path_prefix: "private/docs/", iat: now, exp: now + 60, jti: "j" },
			"wrong-secret"
		);
		const res = await call(
			new Request(`https://secure.demo.example.com/${PRIVATE_KEY}?token=${token}`)
		);
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("invalid_signature");
	});

	it("denies an expired token (403 expired)", async () => {
		const past = Math.floor(Date.now() / 1000) - 3600;
		const token = await signTestJwt({
			sub: "x",
			path_prefix: "private/docs/",
			iat: past - 60,
			exp: past,
			jti: "j",
		});
		const res = await call(
			new Request(`https://secure.demo.example.com/${PRIVATE_KEY}?token=${token}`)
		);
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("expired");
	});

	it("denies a scope mismatch (403 scope_mismatch)", async () => {
		const now = Math.floor(Date.now() / 1000);
		// Token scoped to a different prefix than the requested path.
		const token = await signTestJwt({
			sub: "patient-99",
			path_prefix: "private/patient-99/",
			iat: now,
			exp: now + 60,
			jti: "j",
		});
		const res = await call(
			new Request(`https://secure.demo.example.com/${PRIVATE_KEY}?token=${token}`)
		);
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("scope_mismatch");
	});

	it("returns 404 when the token is valid but the R2 object is missing", async () => {
		// Wipe seed
		await env.BUCKET.delete(PRIVATE_KEY);
		const now = Math.floor(Date.now() / 1000);
		const token = await signTestJwt({
			sub: "x",
			path_prefix: "private/docs/",
			iat: now,
			exp: now + 60,
			jti: "j",
		});
		const res = await call(
			new Request(`https://secure.demo.example.com/${PRIVATE_KEY}?token=${token}`)
		);
		expect(res.status).toBe(404);
	});
});

describe("handleSecure — GET /audit/recent", () => {
	it("returns an empty array when there is no audit history", async () => {
		const res = await call(new Request("https://secure.demo.example.com/audit/recent"));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual([]);
	});

	it("returns audit entries newest-first after access attempts", async () => {
		await seedR2();

		// Generate one allow + one deny.
		const now = Math.floor(Date.now() / 1000);
		const validToken = await signTestJwt({
			sub: "x",
			path_prefix: "private/docs/",
			iat: now,
			exp: now + 60,
			jti: "ok",
		});
		await call(new Request(`https://secure.demo.example.com/${PRIVATE_KEY}?token=${validToken}`));
		await call(new Request(`https://secure.demo.example.com/${PRIVATE_KEY}`)); // missing_token

		const res = await call(new Request("https://secure.demo.example.com/audit/recent"));
		const entries = (await res.json()) as Array<Record<string, unknown>>;
		expect(entries.length).toBe(2);
		// Reverse-timestamp keying means newest-first.
		expect(entries[0]?.decision).toBe("deny");
		expect(entries[1]?.decision).toBe("allow");
	});
});
