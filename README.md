# Multi-CDN Demo

A multi-CDN demo environment built on Cloudflare. This project demonstrates how a single origin can serve multiple CDNs simultaneously, with instant failover, JWT-gated protected content with edge auditing, and zero origin egress fees.

**Target audience:** Technical stakeholders who understand CDN basics and want to see multi-CDN steering, edge security, and cost optimization in action.

---

## What This Demo Proves

This demo answers four questions that come up in every multi-CDN or cloud-migration conversation:

1. **"Can we use one origin for multiple CDNs without replicating data?"** — Yes. One R2 bucket feeds both Cloudflare and CloudFront.
2. **"How fast can we switch or rebalance CDNs?"** — Seconds. Not migration projects.
3. **"Can we gate sensitive content at the edge with audit trails?"** — Yes. JWT validation, path scoping, expiry, and per-request logging — all at the edge.
4. **"What does this cost at the origin?"** — Zero egress fees from R2, regardless of which CDN pulls the data.

---

## Architecture Overview

```
┌──────────────────────┐         ┌──────────────────────┐
│ assets.demo.example  │         │ secure.demo.example  │
│   (public assets)    │         │ (protected assets)   │
└──────────┬───────────┘         └──────────┬───────────┘
           │                                │
   ┌───────▼────────┐               ┌───────▼─────────┐
   │ Cloudflare LB  │               │ Worker (always) │
   │  weighted CF   │               │  - validate JWT │
   │  + CloudFront  │               │  - check expiry │
   └───────┬────────┘               │  - log access   │
           │                        │  - serve from R2│
   ┌───────┴────────┐               └───────┬─────────┘
   │                │                       │
┌──▼──┐      ┌──────▼─────┐                 │
│ CF  │      │ CloudFront │                 │
│ +   │      │            │                 │
│ Wkr │      │            │                 │
└──┬──┘      └──────┬─────┘                 │
   │                │                       │
   └────────┬───────┴───────────────────────┘
            │
   ┌────────▼─────────┐
   │   Cloudflare R2  │
   │  public/  prefix │
   │  private/ prefix │
   │  zero egress     │
   └──────────────────┘
```

### Origin Plane: Cloudflare R2

One bucket, two prefixes:

- **`public/`** — Marketing-grade assets (images, video, CSS) that both CDNs cache freely.
- **`private/`** — Protected content (after-visit summaries, provider-only documents) that only the secure Worker serves, after JWT validation.

R2 is S3-compatible, so CloudFront talks to it as if it were S3. **Egress from R2 is free in all directions**, including to CloudFront.

### Steering Plane: Cloudflare Load Balancer

Sits in front of `assets.demo.<your-domain>` (the public hostname). Two pools:

- **`pool-cf`** — Cloudflare's own CDN, R2 behind it.
- **`pool-cloudfront`** — CloudFront distribution, R2 as origin.

Health monitors probe each pool every 15 seconds. Steering policy is weighted (50/50 by default, adjustable in the dashboard). Both pools return a `served-by` response header so you can see which path served each request.

### Edge Logic Plane: Cloudflare Workers

**Optional on the public side, required on the protected side.**

- **Public Worker** (`cf-pool.demo.<your-domain>`) — Enables per-request surgical control: path-based routing, percent rollouts, and header-based steering. Off by default; the demo flips it on live.
- **Secure Worker** (`secure.demo.<your-domain>`) — Validates JWTs, enforces path scoping and expiry, fetches from R2's `private/` prefix, and writes an access log entry per request.

### Token Issuance Plane

A small Worker endpoint at `secure.demo.<your-domain>/issue` mints short-lived JWTs (60-second TTL, path-scoped). In production this would live behind SSO via Cloudflare Access; in the demo it's open for simplicity, with a note that production adds Access on top.

### Audit Plane: R2-backed Audit Log

Each protected-content access writes a record (timestamp, token subject, asset path, IP, decision) to R2 under the `audit/` prefix. The demo reads from this in real time to show the audit trail populating live.

> **Note:** The build manual originally specified Workers KV for audit logging and the egress counter. During the actual build, KV write permissions were not available on the demo account, so both were migrated to R2. The KV namespace exists but is unused.

---

## The Six Demo Scenarios

This demo is structured as five "beats" (plus an ever-present cost story) that you can run in sequence or independently. Each beat demonstrates a specific capability.

---

### Scenario 1: Multi-CDN Steering (Beat 2)

**What it shows:** The same URL, same file, same origin — served by different CDNs on different requests.

**How it works:** The Cloudflare Load Balancer sits in front of `assets.demo.<your-domain>` and distributes traffic 50/50 between the Cloudflare pool and the CloudFront pool. Both pools pull from the same R2 bucket.

**What you see:**

```bash
for i in {1..10}; do
  curl -sI "https://assets.demo.<your-domain>/images/providers/rahman.jpg?cb=$i" | grep -i served-by
done
```

Responses alternate between `served-by: cf-edge` and `served-by: cloudfront`. The `?cb=$i` cache-bust parameter is essential — without it, Cloudflare's edge caches the first response and every subsequent curl returns the same header from cache. In real traffic, the cache is the point: most requests don't even reach the LB.

**Why it matters:** Your application, your users, and your browser don't know or care which CDN served any given byte. Multi-CDN steering is transparent and automatic.

---

### Scenario 2: Instant Failover (Beat 2, continued)

**What it shows:** When one CDN pool becomes unhealthy, traffic fails over cleanly in ~30 seconds.

**How it works:** The Load Balancer's health monitor probes each pool every 15 seconds with 2 retries. If a pool fails health checks, it is removed from steering immediately.

**Two ways to trigger it:**

- **Option A — Toggle the pool off (instant):** Flip the **Enabled** toggle to off in the LB dashboard → Save. The LB removes it immediately.
- **Option B — Break the health check (more realistic):** Change the monitor's path from `/healthcheck.txt` to `/healthcheck-broken.txt` → Save. Wait 30–45 seconds for the monitor to flip the pool to Critical.

**What you see:** Re-run the curl loop. All ten responses now show `served-by: cf-edge`. If CloudFront has an outage tomorrow, this is what your day looks like — about 30 seconds of degraded mix while health checks notice, then clean failover. No DNS TTL waiting. No engineering ticket. The bucket never moved. The customer never knew.

**Reverse it:** Re-enable the pool toggle or restore the monitor path. Wait for the dashboard to show healthy again. Run the loop — back to 50/50.

---

### Scenario 3: Surgical Control with Workers (Beat 3)

**What it shows:** Per-request routing logic deployed globally in ~10 seconds.

**How it works:** The public Worker adds a layer of surgical control on top of the Load Balancer. It supports three modes, switchable without editing files:

#### Mode: `passthrough` (default)

Serve everything from R2 via the Cloudflare pool. Inject `served-by: cf-edge` on every response.

#### Mode: `path_routing`

Lock specific paths to Cloudflare; redirect everything else to CloudFront.

- `/video/*` → served from R2 (`served-by: cf-edge`, `routing-decision: video-locked-to-cf`)
- Everything else → `302 Redirect` to `cloudfront-pool.demo.<your-domain>`

**Deploy it live:**

```bash
wrangler deploy --env public --var STEERING_MODE:path_routing
```

**Verify it:**

```bash
# Video paths stay on Cloudflare
for i in {1..10}; do
  curl -sI "https://cf-pool.demo.<your-domain>/video/welcome.mp4?cb=$i" | grep -iE 'served-by|routing-decision'
done
# → served-by: cf-edge
# → routing-decision: video-locked-to-cf

# Non-video paths redirect to CloudFront
for i in {1..10}; do
  curl -sI "https://cf-pool.demo.<your-domain>/images/providers/rahman.jpg?cb=$i" | grep -iE 'served-by|location'
done
# → HTTP/2 302
# → location: https://cloudfront-pool.demo.<your-domain>/images/providers/rahman.jpg
```

Follow one redirect to confirm the round-trip:

```bash
curl -sIL "https://cf-pool.demo.<your-domain>/images/providers/rahman.jpg?cb=final" | grep -iE 'served-by|HTTP'
# → HTTP/2 302
# → HTTP/2 200
# → served-by: cloudfront
```

#### Mode: `percent_rollout`

Canary a new CDN before committing. Randomly serve a percentage of traffic from R2; redirect the rest to CloudFront.

**Deploy it live:**

```bash
wrangler deploy --env public --var STEERING_MODE:percent_rollout --var ROLLOUT_PCT:10
```

**Verify it:**

```bash
for i in {1..50}; do
  curl -sI "https://cf-pool.demo.<your-domain>/images/logo.png?cb=$i" | grep -iE 'served-by|location'
done | sort | uniq -c
# → ~5  served-by: cf-edge
# → ~45 location: https://cloudfront-pool.demo.<your-domain>/images/logo.png
```

**Reset when done:**

```bash
wrangler deploy --env public
```

**Why it matters:** Path-based routing and canary rollouts, live, globally, in ten seconds. No re-architecture. No provider negotiation. No procurement cycle. One config, one deploy.

---

### Scenario 4: JWT-Gated Protected Content (Beat 4)

**What it shows:** Time-limited, path-scoped, signed tokens for sensitive documents — served from the same origin as public content, but with a completely different security posture.

**How it works:**

1. The **demo portal** (`portal.demo.<your-domain>`) is a single-page app with a "Generate Link" button.
2. Clicking it `POST`s to `secure.demo.<your-domain>/issue`, which mints a JWT signed with `JWT_SECRET`.
3. The JWT contains:
   - `sub` — the subject (e.g., `patient-demo`)
   - `path_prefix` — what paths this token is allowed to access (e.g., `private/docs/`)
   - `iat` / `exp` — issued-at and expiry (60-second TTL)
   - `jti` — unique token ID for audit correlation
4. The user clicks the signed URL. The **secure Worker** validates the JWT, checks expiry, checks path scope, then serves the file from R2's `private/` prefix.

**What you see:**

- Click "Generate 60-second link to After-Visit Summary." A URL appears with a countdown timer.
- Click the URL. The PDF opens.
- The token is signed, scoped to this specific document, and expires in 60 seconds.

**Production note:** In production, the `/issue` endpoint sits behind your SSO via Cloudflare Access — same identity provider, same MFA, same access policies. The Worker becomes a policy enforcement point, not just a token validator.

---

### Scenario 5: Edge Auditing (Beat 4, continued)

**What it shows:** Every access — allowed or denied — is logged at the edge with timestamp, subject, asset path, IP, and decision reason.

**How it works:** The secure Worker writes an audit record to R2 for every request to `/private/*`, regardless of outcome:

- **Allow** — token valid, not expired, path matches scope.
- **Deny: missing_token** — no `?token=` parameter.
- **Deny: invalid_signature** — token signature doesn't verify.
- **Deny: expired** — token `exp` is in the past.
- **Deny: scope_mismatch** — requested path doesn't start with the token's `path_prefix`.

**What you see:** Open the **audit view** (`audit.demo.<your-domain>`) in a second tab. It polls `secure.demo.<your-domain>/audit/recent` every 2 seconds and shows a live table:

| Timestamp | Subject | Path | IP | Decision | Reason |
|---|---|---|---|---|---|
| May 12 14:32:15.234 | patient-demo | private/docs/after-visit-summary-sample.pdf | 203.0.113.42 | **allow** | — |
| May 12 14:33:25.891 | patient-demo | private/docs/after-visit-summary-sample.pdf | 203.0.113.42 | **deny** | expired |

New rows flash yellow for 1 second when they appear.

**Demo the deny flow:** Wait until the countdown hits zero plus a few seconds. Click the same URL again. **403.** Refresh the audit view. A new **deny** entry appears with reason `expired`.

**Why it matters:** If audit asks "who accessed what, when, and was it authorized," that's the answer — generated at the edge, in real time, without a SIEM integration.

**Production note:** The demo uses R2 for audit storage. Production would route to a durable SIEM or log aggregator.

---

### Scenario 6: Zero Origin Egress Fees (Beat 5, ever-present)

**What it shows:** Origin egress charges stay at $0.00 no matter how much traffic flows through either CDN.

**How it works:** R2 does not charge for egress. Period. Not to Cloudflare's CDN. Not to CloudFront. Not to the internet. Every byte that leaves the bucket is free.

**What you see:** The **egress meter** (`meter.demo.<your-domain>`) shows a big `$0.00` with subtext "Origin egress charges, this hour, real traffic." Below it, a comparison table shows what the same traffic would cost on traditional clouds:

| Provider | List price | Enterprise blended | This hour (list) | This hour (enterprise) |
|---|---|---|---|---|
| AWS S3 egress | $0.09/GB | $0.05/GB | $X.XX | $X.XX |
| Azure Blob egress | $0.087/GB | $0.05/GB | $X.XX | $X.XX |
| GCS multi-region | $0.12/GB | $0.08/GB | $X.XX | $X.XX |
| **Cloudflare R2** | **$0.00/GB** | **$0.00/GB** | **$0.00** | **$0.00** |

**Scale it to hospital-system volume:**

| If your system serves... | Annual egress savings (30% miss, $0.05/GB blended) | |
|---|---|---|
| 10 TB/month | ~$1,800/year | small hospital web presence |
| 50 TB/month | ~$9,000/year | mid-size system |
| 100 TB/month | ~$18,000/year | large multi-facility |
| 500 TB/month | ~$90,000/year | regional health network |

The meter auto-refreshes every 10 seconds. Use `?demo_seed=10` to prime realistic-looking numbers for presentation.

**Honest methodology note:** The meter counts bytes pulled from R2 origin only. CDN cache hits (the majority of real traffic) don't trigger origin egress at all — but on traditional clouds, even origin pulls cost money. The meter slightly understates total traffic because CloudFront-pool requests are opaque to the Cloudflare side; the $0.00 number is actually conservative.

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

| Binding | Type | Purpose |
|---|---|---|
| `BUCKET` | R2 Bucket | `multicdn-demo-20260505-2351` — stores public assets, private docs, audit logs, and meter counters |

## Secrets

Set via `wrangler secret put SECRET_NAME --env <env>`. See `.dev.vars.example` for local dev.

| Secret | Environment | Purpose |
|---|---|---|
| `JWT_SECRET` | `secure` | HS256 signing key for protected-content JWTs |

## Project Structure

```
src/
  workers/
    public-steering/index.ts   # Public Worker: passthrough / path_routing / percent_rollout
    secure/index.ts            # Secure Worker: JWT issuance + validation + audit logging
    meter/index.ts             # Meter Worker: renders live egress-cost comparison UI
  pages/
    portal/index.html          # Demo patient portal (Pages-hosted)
    audit/index.html           # Live audit log viewer (Pages-hosted)
  lib/
    meter.ts                   # Shared egress-counter helpers (R2-backed)
  types.ts                     # Shared TypeScript types
```

## Honest Caveats

- **For PHI in production,** the entire stack moves to Cloudflare Enterprise tier under a BAA. The demo is illustrative — the architecture and user experience are the same, but the BAA paperwork wraps around it.
- **The token-issuance endpoint** in the demo is open. In production it sits behind Cloudflare Access tied to the customer's IdP.
- **Audit logging** in the demo is R2-backed. Production routes to durable storage / SIEM.
- **The Worker layer is optional.** Many customers run multi-CDN purely on the Load Balancer layer; the Worker is shown to demonstrate what becomes available, not what's required.
- **For full geographic-failure resilience** ("what if Cloudflare itself has an outage?"), customers can replicate R2 to S3 or another origin. That's a different conversation.

## Companion Docs

- [`multicdn-demo-architecture-20260505T2317Z.md`](./multicdn-demo-architecture-20260505T2317Z.md) — Detailed architecture decisions and design rationale
- [`multicdn-demo-run-of-show-20260505T2317Z.md`](./multicdn-demo-run-of-show-20260505T2317Z.md) — Step-by-step script for running the demo in a meeting
- [`multicdn-demo-build-manual-20260505T2317Z.md`](./multicdn-demo-build-manual-20260505T2317Z.md) — Complete build instructions for reproducing the environment
- [`STATE.md`](./STATE.md) — Live resource inventory (hostnames, IDs, secrets)
