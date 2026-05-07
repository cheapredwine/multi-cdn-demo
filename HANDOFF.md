# Here's Where We Left Off

**Date:** 2026-05-07 (updated 04:55Z)
**Status:** ✅ **Demo fully operational and verified end-to-end.** All blockers resolved; UI bugs found during dry-run also fixed.

---

## What's working

| Component | URL | Verified |
|---|---|---|
| R2 Bucket | `multicdn-demo-20260505-2351` | ✓ |
| CF Pool Worker | `cf-pool.demo.jsherron.com` | ✓ 200, `served-by: cf-edge` |
| CloudFront Pool | `cloudfront-pool.demo.jsherron.com` | ✓ 200, `/healthcheck.txt` returns `ok` |
| Load Balancer | `assets.demo.jsherron.com` | ✓ 200, both pools healthy, Host overrides set |
| Secure Worker | `secure.demo.jsherron.com` | ✓ JWT issue + protected content + audit; CORS verified |
| Egress Meter | `meter.demo.jsherron.com` | ✓ HTML renders; bytes counter wired |
| Portal Pages | `portal.demo.jsherron.com` and `multicdn-demo-portal.pages.dev` | ✓ Custom domain attached |
| Audit Pages | `audit.demo.jsherron.com` and `multicdn-demo-audit.pages.dev` | ✓ Custom domain attached |
| workers.dev fallbacks | `multicdn-demo-{public-steering,secure,meter}.jsherron-test-account.workers.dev` | ✓ Enabled and serving |

## What got resolved 2026-05-06

### Code (PR #1, merged into branch `feat/run-of-show-reconciliation`)
- Code gates were 14 errors — now green with 41 tests
- Toolchain bumped to current majors; vitest config migrated to `cloudflareTest()` plugin
- `wrangler.toml` collapsed to single config with `[env.public|secure|meter]`
- Real `path_routing` (302 to CloudFront for non-video paths)
- CORS on secure Worker
- Egress-meter byte counter wired into both write-side workers
- Pages custom domains attached for portal and audit
- All three workers redeployed

### Infrastructure (dashboard, today)
- **Wildcard SSL cert** `*.demo.jsherron.com` ordered and active
- **CloudFront pool monitor** path corrected to `/healthcheck.txt` (was probing `/public/healthcheck.txt`, which CloudFront's origin-path-prepend turned into a non-existent key)
- **Host header overrides** added to both LB pools so each pool origin receives requests with SNI/Host matching its own hostname (CloudFront's ACM cert only covers `cloudfront-pool.demo.jsherron.com`, not the inbound LB hostname)
- **Pages custom domain CNAMEs** added: `portal.demo.jsherron.com → multicdn-demo-portal.pages.dev` and `audit.demo.jsherron.com → multicdn-demo-audit.pages.dev`, both proxied. Pages auto-validated and provisioned per-domain certs once CNAMEs were in place.

### UI bugs found during dry-run, all fixed
- **Audit page timestamps had no date** (only HH:MM:SS) — couldn't tell which row was "now" vs old rehearsal entries.
- **Audit page rendered rows in reverse order** — newest at bottom because `insertBefore(tr, firstChild)` inverted the API's newest-first ordering.
- **Audit page missed new entries on a capped 50-row list** — `lastCount`-based new-entry detection underflowed.
- **Portal hid the link after the 60-second countdown** — SE had to remember to copy the link before expiry to demo the 403; now the link stays clickable with a red EXPIRED indicator inline.
- **Meter page was tall enough to require scrolling** for the AE screenshot — compressed via tighter padding/margins, smaller hero font, consolidated footnotes.

### Run-of-show updates (post-dry-run)
- All four curl loops now cache-bust with `?cb=$i`. Without it, Cloudflare's edge caches the first MISS and every subsequent curl shows the same `served-by` from cache — burned a verification session before catching this.
- Beat 2 failover mechanism expanded: explicit click-paths for both "toggle pool off" (instant) and "break monitor" (~30s, more realistic) options.

## What's been verified live (this session)

| Beat | Verified | How |
|---|---|---|
| 2 — multi-CDN steering | ✅ | Browser DevTools at `assets.demo.jsherron.com` showed mix of `served-by: cf-edge` and `cloudfront` once cache-busted with `?cb=` |
| 4 — token + protected content | ✅ | Browser flow at `portal.demo.jsherron.com`: Generate → URL with countdown → click → PDF served. CORS verified clean (no console errors). |
| 4 — deny path | ✅ | Waited for token expiry, refreshed PDF tab → 403; audit page showed new top-row deny with red pill and reason `expired` |
| 4 — audit live polling | ✅ | Allow + deny rows appeared in audit table within 2s of each event, newest at top |
| 5 — meter screenshot | ✅ | `?demo_seed=10` shows hero `$0.00`, comparison table populated, hospital scenarios, all on one screen |
| Pool hostnames direct | ✅ | Each `cf-pool.demo` and `cloudfront-pool.demo` returns its own `served-by` header |

## What's left

Nothing infra-blocking. Optional polish:

1. **Beat 3 deploy-rehearsal** — run `wrangler deploy --env public --var STEERING_MODE:path_routing` and back from your normal demo terminal once, to confirm wrangler auth + account-id env are set up. The worker logic is covered by tests; this is purely about avoiding shell mishaps live.
2. **Generate real meter traffic** before the meeting (50–100 requests through `assets.demo`) so the AE screenshot shows non-trivial bytes-served. The demo_seed param is fine as fallback.
3. **Merge PR #1**: https://github.com/cheapredwine/cf-cdn-demo/pull/1 (currently 8 commits)
4. **Update README.md** — still has template content (not blocking)

## Files you should know about

- `STATE.md` — full inventory; updated to reflect operational state
- `RESTART.md` — technical context for next agent session
- `TODO.md` — now empty of P1/P2 items; only polish remains
- `docs/fix-assets-demo-ssl.md` — runbook for the LB SSL/health/host-override fix sequence (kept as reference)
- `multicdn-demo-run-of-show-*.md` — updated 2026-05-06 with env-based deploys, WARP note, demo_seed, longer LB-flip wait, real path_routing
- `wrangler.toml` — single source of truth, env-based
- `src/lib/meter.ts` — shared bytes-counter helper

## Verify from your end

```bash
warp-cli disconnect
for i in {1..10}; do
  curl -sI https://assets.demo.jsherron.com/images/providers/rahman.jpg | grep -i served-by
done
warp-cli connect
```

Expected: roughly 50/50 mix of `served-by: cf-edge` and `served-by: cloudfront`.

## Monthly cost if left running

~$5–10/month (LB ~$5 + CloudFront ~$0–5 depending on traffic + R2 storage). workers.dev URLs are free.

## Teardown when done

See `STATE.md` for the full checklist. Don't forget the wildcard cert (delete from SSL/TLS → Edge Certificates) and the workers.dev subdomains (disable per worker).

---

**Bottom line:** demo is ready. Take a screenshot of the meter after generating some traffic, do a dry run, and you're set.
