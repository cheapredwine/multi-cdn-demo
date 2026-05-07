# Multi-CDN Demo — STATE

**Generated:** 2026-05-05T23:51Z
**Last updated:** 2026-05-07T05:00Z (browser dry-run verified end-to-end; UI bug fixes for audit/portal/meter; Pages domain CNAMEs added)
**Domain:** jsherron.com
**Cloudflare Account ID:** [removed]
**Cloudflare Zone ID:** [removed]
**AWS Account ID:** 512629184821

---

## R2 resources

| Resource | Name/ID | Notes |
|---|---|---|
| Bucket | `multicdn-demo-20260505-2351` | 12 objects uploaded (Phase 1) |
| Custom domain | `cf-pool.demo.jsherron.com` | Active, SSL active (Phase 2) |

## Worker resources

All three deployed via single `wrangler.toml` with `[env.public|secure|meter]`. `workers.dev` URLs enabled as fallback.

| Worker | Custom domain | workers.dev fallback | Notes |
|---|---|---|---|
| `multicdn-demo-public-steering` | `cf-pool.demo.jsherron.com` | `multicdn-demo-public-steering.jsherron-test-account.workers.dev` | Phase 4. path_routing now 302s non-video to CloudFront (real behavior, not header-only). |
| `multicdn-demo-secure` | `secure.demo.jsherron.com` | `multicdn-demo-secure.jsherron-test-account.workers.dev` | Phase 6. CORS headers (`*`) on all endpoints + OPTIONS preflight. |
| `multicdn-demo-meter` | `meter.demo.jsherron.com` | `multicdn-demo-meter.jsherron-test-account.workers.dev` | Phase 7. Reads R2 bytes counter (now actually populated by public + secure). |

## KV namespaces

| Namespace | ID | Notes |
|---|---|---|
| `multicdn-demo-audit-20260505-2351` | `fdbdbb94864b4fb5bbdc19a011584f0a` | Phase 6 — created but **unused** (KV write perms issue, migrated to R2). Binding removed from `wrangler.toml` 2026-05-06. Still listed here for teardown. |

## Load Balancer resources

| Resource | ID | Notes |
|---|---|---|
| Pool `pool-cf-20260505-2351` | Created via dashboard | Origin `cf-pool.demo.jsherron.com`. Host header override = origin hostname. |
| Pool `pool-cloudfront-20260505-2351` | Created via dashboard | Origin `cloudfront-pool.demo.jsherron.com`. Host header override = origin hostname. Monitor path `/healthcheck.txt` (no `/public/` because CloudFront origin path strips it). |
| Load Balancer `assets.demo.jsherron.com` | Created via dashboard | Steering 50/50 random. Both pools healthy. |
| SSL Certificate `*.demo.jsherron.com` | Advanced Cert | Covers LB hostname + all `*.demo` subdomains. Replaces three superseded subdomain certs. |

## AWS resources

| Resource | ARN/ID | Notes |
|---|---|---|
| IAM user `cf-multicdn-demo-20260505-2351` | `arn:aws:iam::512629184821:user/cf-multicdn-demo-20260505-2351` | Phase 3 — account hygiene |
| CloudFront distribution | `E362FEEO2DM9NE` | Active, custom domain + ACM cert |
| ACM certificate | `arn:aws:acm:us-east-1:512629184821:certificate/61445144-6bc4-4f98-96ac-950013484a1d` | Phase 3 — ISSUED |
| R2 read-only API token | TBD | Phase 3 |

## DNS records

| Hostname | Type | Target | Proxy | Notes |
|---|---|---|---|---|
| `cf-pool.demo.jsherron.com` | CNAME | R2 custom domain | Orange | Worker-bound via custom_domain |
| `cloudfront-pool.demo.jsherron.com` | CNAME | CloudFront distribution | Gray | DNS-only; CloudFront serves with ACM cert |
| `assets.demo.jsherron.com` | (LB-managed) | n/a | Orange | LB virtual hostname; auto-published by LB, no manual DNS row |
| `secure.demo.jsherron.com` | (Worker-managed) | n/a | Orange | Worker custom_domain |
| `portal.demo.jsherron.com` | CNAME | `multicdn-demo-portal.pages.dev` | Orange | Added via dashboard 2026-05-07 |
| `audit.demo.jsherron.com` | CNAME | `multicdn-demo-audit.pages.dev` | Orange | Added via dashboard 2026-05-07 |
| `meter.demo.jsherron.com` | (Worker-managed) | n/a | Orange | Worker custom_domain |

## Secrets generated

| Secret | Location | Notes |
|---|---|---|
| `JWT_SECRET` | Wrangler secret (secure Worker) | Phase 6 |
| `X-Multicdn-Demo-Secret` | CloudFront custom header | Phase 3 — `XhYsEaHw/CDBfVWrDzEpM6r/Yg/cnfzqBc7HSntZd74=` |
| R2 API token (read-only) | Cloudflare API tokens | Phase 3 |

---

## Teardown checklist

1. Delete CloudFront distribution
2. Delete ACM certificate
3. Delete IAM user
4. Delete R2 read-only API token
5. Delete Load Balancer pools and LB
6. Delete Workers (public, secure, meter)
7. Delete KV namespace
8. Delete R2 bucket and all objects
9. Delete DNS records
10. Delete Pages projects (portal, audit)

## Estimated monthly cost if left running

- R2 storage: ~$0.015/GB (negligible for demo data)
- Workers: Free tier covers demo traffic
- Load Balancer: ~$5/mo
- CloudFront: ~$0.01/GB for North America/Europe
- Total: ~$5-10/month

---

## R2 keys in use

| Prefix | Purpose | Writers | Readers |
|---|---|---|---|
| `public/` | Demo assets (images, video, css, healthcheck) | seed upload (Phase 1) | both LB pools |
| `private/docs/` | Demo PDFs (DEMO ONLY watermark) | seed upload (Phase 1) | secure Worker |
| `audit/` | Audit log entries (`audit/<reverse-ts>-<jti>.json`) | secure Worker | secure `/audit/recent`, audit Pages UI |
| `meter/bytes-hour-{YYYY-MM-DD-HH}.json` | Hourly bytes-served counter | public-steering + secure Workers (via `src/lib/meter.ts`) | meter Worker |

## Code state (2026-05-06)

- `npm run typecheck`, `npm run lint`, `npm test` all pass.
- Toolchain bumped: wrangler ^4, vitest ^4.1, vitest-pool-workers ^0.16, workers-types ^4.20260506.1.
- Vitest config migrated to `cloudflareTest()` plugin API (now `vitest.config.mts`).
- `Env` type now augments `Cloudflare.Env` in `src/types.ts`.
- New: `src/lib/meter.ts` — shared bytes-counter helper.
- `wrangler.public.toml` now sets `STEERING_MODE`/`ROLLOUT_PCT` (was missing).
- `wrangler.toml` no longer declares the unused KV binding.

**Deploy commands (single config, env-based):**
```
CLOUDFLARE_ACCOUNT_ID=[removed]
npx wrangler deploy --env public
npx wrangler deploy --env secure
npx wrangler deploy --env meter

# Live mode-toggle for Beat 3 (no file edit needed):
npx wrangler deploy --env public --var STEERING_MODE:path_routing
npx wrangler deploy --env public --var STEERING_MODE:percent_rollout --var ROLLOUT_PCT:10
npx wrangler deploy --env public   # reset to passthrough
```

All three workers were redeployed 2026-05-06T00:55Z with the env-based config + CORS + real path_routing + meter wiring.
