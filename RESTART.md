# Multi-CDN Demo — Restart Documentation

**Created:** 2026-05-06
**Last updated:** 2026-05-07T04:55Z
**Status:** ✅ Demo fully operational and verified end-to-end. Code green, infra resolved, UI bugs fixed during dry-run, no open blockers.

---

## Quick Status

| Component | URL | Status | Notes |
|---|---|---|---|
| R2 Bucket | `multicdn-demo-20260505-2351` | ✅ Active | Public + private + `audit/` + `meter/` prefixes |
| CF Pool Worker | `cf-pool.demo.jsherron.com` | ✅ Deployed (current code) | Returns `served-by: cf-edge` |
| CloudFront Pool | `cloudfront-pool.demo.jsherron.com` | ✅ Active | Returns `served-by: cloudfront` |
| Load Balancer | `assets.demo.jsherron.com` | ✅ **Operational** | Wildcard cert active; both pools healthy; Host header overrides set |
| Secure Worker | `secure.demo.jsherron.com` | ✅ Deployed (current code) | JWT + audit log + CORS verified |
| Egress Meter | `meter.demo.jsherron.com` | ✅ Deployed (current code) | Bytes counter wired; populates with real traffic |
| Portal Pages | `portal.demo.jsherron.com` / `multicdn-demo-portal.pages.dev` | ✅ Custom domain attached | |
| Audit Pages | `audit.demo.jsherron.com` / `multicdn-demo-audit.pages.dev` | ✅ Custom domain attached | |
| workers.dev fallbacks | `multicdn-demo-{public-steering,secure,meter}.jsherron-test-account.workers.dev` | ✅ Enabled | Backup hostnames if `*.demo` ever breaks |

---

## What Changed 2026-05-06 (Layer 1 cleanup)

### Code-gate green
- All three of `npm run typecheck`, `npm run lint`, `npm test` pass.
- Was 14 errors before (3 typecheck, 11 lint).

### Toolchain bumped
- `wrangler` ^3.0.0 → ^4.0.0
- `vitest` ^2.0.0 → ^4.1.0
- `@cloudflare/vitest-pool-workers` ^0.5.0 → ^0.16.0
- `@cloudflare/workers-types` ^4.0.0 → ^4.20260506.1
- Compat-date warning (`2025-04-01` not supported) is gone.

### Config API migration
- `vitest.config.ts` → `vitest.config.mts` (ESM-only package)
- Now uses `cloudflareTest()` plugin from `@cloudflare/vitest-pool-workers` (the old `defineWorkersConfig` was removed in 0.16).

### Type model change
- `Env` in `src/types.ts` now augments the global `Cloudflare.Env` namespace.
- `cloudflare:test`'s `env` is typed as `Cloudflare.Env`, so test code accepts it without per-test `ProvidedEnv` augmentation.

### Functional fixes from build manual review
1. **Meter incrementer wired.** Manual specifies both Workers update the bytes counter on each R2 fetch; neither did. Now both do, via `src/lib/meter.ts` and `ctx.waitUntil(incrementBytesServed(env, object.size))`. Non-atomic R/M/W per the manual's note.
2. **`wrangler.public.toml` was missing `STEERING_MODE`/`ROLLOUT_PCT`.** Added; live mode-toggling will work.
3. **`wrangler.toml` had a stale KV binding** (audit migrated to R2 long ago). Removed; commented why.
4. **Build manual** got a top-of-file note explaining the KV→R2 migration so future agents don't follow the manual blindly.

### Layout
- Deleted empty `src/handlers/` and original empty `src/lib/`.
- Re-created `src/lib/` with `meter.ts` (shared bytes counter helper).
- `meter/index.ts` now imports `currentHourKey` from the shared lib instead of duplicating it.
- `CLAUDE.md` File structure section updated to reality.

### Deployed
All three workers were redeployed via the env-based config 2026-05-06T00:55Z. workers.dev fallbacks were enabled in the same deploy. To redeploy:
```bash
export CLOUDFLARE_ACCOUNT_ID=[removed]
npx wrangler deploy --env public
npx wrangler deploy --env secure
npx wrangler deploy --env meter
```

### LB infrastructure resolved 2026-05-06T20:30Z

Three sequential issues, all fixed via dashboard:

1. **SSL** — Ordered wildcard `*.demo.jsherron.com` Advanced Certificate
2. **CloudFront pool monitor** — Path corrected to `/healthcheck.txt` (was `/public/healthcheck.txt` which CloudFront's origin path turned into a missing-key 403)
3. **LB pool Host header overrides** — Set each pool's Host override to its origin hostname so CloudFront receives the SNI matching its ACM cert

See `docs/fix-assets-demo-ssl.md` for the runbook covering all three.

### Pages custom domains resolved 2026-05-07T04:35Z

The Pages domain attachments I made via API earlier were stuck in HTTP-validation pending because the underlying CNAMEs hadn't been written to the zone (Pages doesn't auto-create DNS for HTTP-validation method). User added two CNAMEs in dashboard:

- `portal.demo.jsherron.com → multicdn-demo-portal.pages.dev`, proxied
- `audit.demo.jsherron.com → multicdn-demo-audit.pages.dev`, proxied

Pages auto-validated within ~2 minutes and provisioned per-domain certs.

### UI bugs fixed during browser dry-run 2026-05-07T04:30–04:55Z

Found and fixed during live verification:

- **Audit page timestamps** — added date (`May 7 04:42:51.123` instead of just `04:42:51`)
- **Audit page row order** — was rendering newest at bottom because `insertBefore(tr, firstChild)` over a newest-first iterator inverted ordering. Now iterates fresh entries in reverse.
- **Audit page new-entry detection** — `lastCount`-based logic underflowed at the API's 50-row cap; replaced with a `Set` of seen `jti`s.
- **Portal expiry** — link is no longer hidden when the countdown hits 0; SE can click the same URL post-expiry to demo the 403 without copying it earlier. Inline countdown chip changes to red `EXPIRED`.
- **Meter page** — compressed for single-screen screenshot. Body padding 2rem→1rem, hero amount 96pt→64pt, h2 margins halved, table padding shrunk, two footnotes consolidated.

### Run-of-show post-dry-run updates

- All four curl loops cache-bust with `?cb=$i`. Cloudflare's edge caches repeated curls of the same URL; without cache-bust the loop shows the same `served-by` from cache and the steering verification silently lies.
- Beat 2 failover mechanism expanded with explicit click-paths for both "toggle pool off" (instant) and "break monitor" (~30s, more realistic) options.

---

## What's Working

### Phase 1–4: R2 + Workers ✅
- All three workers deployed and responding (current repo code)
- R2 bucket serving public assets
- CloudFront distribution serving via `cloudfront-pool.demo.jsherron.com`

### Phase 5: Load Balancer ✅
- Both pools healthy
- Wildcard cert provisioned and active
- Host header overrides correctly route SNI to each pool's origin
- 50/50 random steering verified end-to-end

### Phase 6–7: Protected Content + Meter ✅
- Token issuance works (CORS-aware)
- Protected PDF serves correctly with valid token
- Audit log records access (R2-backed; both allow + deny variants)
- Meter UI populates from real traffic (was $0.00 forever before)

---

## Known Issues

### 1. Local WARP Interference
**Symptom:** `curl` and Python fail with `SSL_ERROR_SYSCALL` when hitting `assets.demo.jsherron.com`
**Root Cause:** Cloudflare WARP on this Mac intercepts HTTPS traffic with its own CA
**Fix:** Test from browser or `warp-cli disconnect` before running verification

### 2. No KV Write Permissions
**Symptom:** Workers with KV bindings fail to deploy with `code: 10023`
**Workaround:** Migrated audit logging and egress meter from KV to R2
**Impact:** Minimal — R2 works fine for demo-scale data
**As of 2026-05-06:** stale KV binding removed from `wrangler.toml`; build manual annotated

### 3. ACM Certificate Slow Validation
**Symptom:** First cert stuck in PENDING_VALIDATION for 10+ minutes
**Resolution:** Created second cert which validated immediately
**Note:** First cert (`dde7836f...`) deleted, using second cert (`61445144...`)

### 4. `verify-all.sh` disables TLS globally
**Symptom:** Script uses `ssl.CERT_NONE` to work around WARP
**Impact:** Can't catch a bad/missing cert — passes vacuously even when SSL is broken
**Fix (deferred):** drop the `ctx` lines around line 26–28 if you want an honest TLS check

---

## To Verify Load Balancer (after wildcard cert + redeploy)

From a non-WARP machine or after disconnecting WARP:

```bash
# Test steering
for i in {1..10}; do
  curl -sI https://assets.demo.jsherron.com/public/images/providers/rahman.jpg | grep -i served-by
done

# Should show mix of:
# served-by: cf-edge
# served-by: cloudfront
```

Or in browser DevTools:
```javascript
fetch('https://assets.demo.jsherron.com/public/images/logo.png')
  .then(r => console.log(r.headers.get('served-by')))
```

---

## Resources Created

### Cloudflare
- **Zone:** jsherron.com (Zone ID: `[removed]`)
- **Account:** JSherron Test Account (`[removed]`)
- **R2 Bucket:** `multicdn-demo-20260505-2351`
- **Workers:**
  - `multicdn-demo-public-steering` → `cf-pool.demo.jsherron.com`
  - `multicdn-demo-secure` → `secure.demo.jsherron.com`
  - `multicdn-demo-meter` → `meter.demo.jsherron.com`
- **KV Namespace:** `multicdn-demo-audit-20260505-2351` (id: `fdbdbb94864b4fb5bbdc19a011584f0a`) — **unused** (binding removed from wrangler.toml 2026-05-06)
- **Pages Projects:**
  - `multicdn-demo-portal`
  - `multicdn-demo-audit`
- **Load Balancer:** `assets.demo.jsherron.com` (created via dashboard)
  - Pool: `pool-cf-20260505-2351`
  - Pool: `pool-cloudfront-20260505-2351`

### AWS
- **Account:** 512629184821
- **IAM User:** `cf-multicdn-demo-20260505-2351`
- **CloudFront Distribution:** `E362FEEO2DM9NE`
- **ACM Certificate:** `arn:aws:acm:us-east-1:512629184821:certificate/61445144-6bc4-4f98-96ac-950013484a1d`
- **Response Headers Policy:** `c9fc8768-3860-4ec0-b623-10848f3061f0`

### DNS Records
All created in Cloudflare dashboard:
- `cf-pool.demo` → Worker (orange)
- `cloudfront-pool.demo` → CloudFront (gray)
- `assets.demo` → Load Balancer (orange)
- `secure.demo` → Worker (orange)
- `portal.demo` → Pages (orange)
- `audit.demo` → Pages (orange)
- `meter.demo` → Worker (orange)
- `_851748144...cloudfront-pool.demo` → ACM validation (gray)

---

## Files in This Repo

```
cf-cdn-demo/
├── src/
│   ├── index.ts                       # Default-config Worker (template stub, vitest target)
│   ├── types.ts                       # Augments Cloudflare.Env; re-exports as Env
│   ├── lib/
│   │   └── meter.ts                   # Shared bytes-counter helper (NEW 2026-05-06)
│   ├── workers/
│   │   ├── public-steering/index.ts   # LB pool Worker (now meter-instrumented)
│   │   ├── secure/index.ts            # JWT + protected content (now meter-instrumented)
│   │   └── meter/index.ts             # Egress meter UI (uses shared lib)
│   └── pages/
│       ├── portal/index.html          # Patient portal UI
│       └── audit/index.html           # Audit log UI
├── scripts/
│   ├── generate-seed.py               # Generates demo images/PDFs
│   └── verify-all.sh                  # End-to-end verification (note: ssl.CERT_NONE)
├── seed/                              # Generated demo assets
├── wrangler.toml                      # Default dev/test config (vitest reads this)
├── wrangler.public.toml               # Deploy: public-steering (now has STEERING_MODE/ROLLOUT_PCT)
├── wrangler.secure.toml               # Deploy: secure
├── wrangler.meter.toml                # Deploy: meter
├── vitest.config.mts                  # New cloudflareTest() plugin API
├── STATE.md                           # Resource inventory + R2 key map + code state
├── HANDOFF.md                         # Where we left off
├── TODO.md                            # Prioritized next steps
├── RESTART.md                         # This file
├── CLAUDE.md                          # Agent behavioral rules
├── AGENTS.md                          # Agent inventory (template, mostly empty)
├── README.md                          # Still has template content
└── multicdn-demo-*-20260505T2317Z.md  # Architecture, build manual, run-of-show, AE script
```

---

## To Pick Up Where We Left Off

1. **Order wildcard cert** for `*.demo.jsherron.com` (see TODO.md Priority 2)
2. **Redeploy three workers** to land 2026-05-06 code changes (see TODO.md Priority 1)
3. **Verify LB steering** from non-WARP machine
4. **Add Pages custom domains** if not already done
5. **Run `./scripts/verify-all.sh`**
6. **Generate real traffic** and confirm meter shows non-zero (this is the new behavior unlocked by the meter wiring)
7. **Test token expiry** (wait 65s)
8. **Demo dry run**

---

## Teardown Order (When Done)

1. Delete Load Balancer + pools
2. Delete CloudFront distribution
3. Delete ACM certificate
4. Delete Workers (public, secure, meter)
5. Delete Pages projects
6. Delete R2 bucket + objects
7. Delete DNS records
8. Delete IAM user
9. Delete KV namespace (`fdbdbb94864b4fb5bbdc19a011584f0a`) — was unused but provisioned
10. Delete the wildcard Advanced Certificate (after step 1)
