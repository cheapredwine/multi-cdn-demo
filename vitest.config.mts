import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.toml" },
			miniflare: {
				// Test-only secrets/vars. Real JWT_SECRET is set via `wrangler secret put --env secure`.
				bindings: {
					JWT_SECRET: "test-jwt-secret-do-not-use-in-prod",
				},
			},
		}),
	],
	test: {
		// Fail fast on first error during development
		bail: 1,
	},
});

