# multicdn-demo

A multi-CDN demo environment built on Cloudflare. Proves single-origin multi-CDN steering, instant failover, JWT-gated protected content with edge auditing, and zero R2 egress fees.

---

## Setup

```bash
bun install
cp .dev.vars.example .dev.vars
# Fill in .dev.vars with local secret values
```

## Dev

```bash
bun run dev        # local Worker at http://localhost:8787
bun test           # run tests
bun run lint       # lint and format check
bun run typecheck  # TypeScript check
bun run check      # all three at once
```

## Deploy

This project deploys **three separate Workers** from a single `wrangler.toml`:

```bash
# Deploy individual Workers
bun run deploy:public   # public-steering Worker (cf-pool.demo...)
bun run deploy:secure   # secure Worker (JWT + protected content)
bun run deploy:meter    # egress meter Worker

# Deploy all three in sequence
bun run deploy:all

# Live mode-toggle for Beat 3 (no file edit needed)
wrangler deploy --env public --var STEERING_MODE:path_routing
wrangler deploy --env public --var STEERING_MODE:percent_rollout --var ROLLOUT_PCT:10
wrangler deploy --env public   # reset to passthrough
```

> **Note:** `bun run deploy` (without `--env`) deploys a test-only stub (`src/index.ts`) — not the actual demo Workers. Always use `--env public|secure|meter` or the convenience scripts above.

## Bindings

<!-- TODO: Document the bindings this Worker uses -->

| Binding | Type | Purpose |
|---|---|---|
| — | — | — |

## Secrets

<!-- TODO: Document secrets this Worker needs -->

Set via `wrangler secret put SECRET_NAME`. See `.dev.vars.example` for local dev.

| Secret | Purpose |
|---|---|
| — | — |
