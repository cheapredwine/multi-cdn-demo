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

```bash
wrangler deploy
```

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
