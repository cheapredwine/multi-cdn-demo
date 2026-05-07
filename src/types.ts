/**
 * Shared types for this Worker.
 * All types used across more than one file go here.
 */

/**
 * Worker environment bindings.
 *
 * Declared as a Cloudflare.Env augmentation so cloudflare:test (vitest pool)
 * can see the binding shape via `env: Cloudflare.Env`. Re-exported as `Env`
 * for ergonomic use in worker source.
 */
declare global {
	namespace Cloudflare {
		interface Env {
			BUCKET: R2Bucket;
			JWT_SECRET: string;
			STEERING_MODE: string;
			ROLLOUT_PCT: string;
		}
	}
}

export type Env = Cloudflare.Env;
