# Agent TODO — Next Session

**Status:** ✅ Demo fully operational and verified end-to-end as of 2026-05-07T04:55Z. All P1/P2 items resolved across two sessions. Only polish remains.

---

## 🟢 Optional polish (pre-meeting)

- [ ] **Beat 3 deploy-rehearsal** — `wrangler deploy --env public --var STEERING_MODE:path_routing` from your demo shell once, to confirm auth + `CLOUDFLARE_ACCOUNT_ID` env are set up. Worker logic is covered by tests; this is shell-readiness only.
- [ ] **Generate real meter traffic** (50–100 requests through `assets.demo`) before taking the AE screenshot — bytes counter now populates from real bytes after Gap 1 fix landed. `?demo_seed=10` is fine as fallback if you don't have time.
- [ ] **Merge PR #1**: https://github.com/cheapredwine/cf-cdn-demo/pull/1 — 8 commits as of session end.
- [ ] **Update `README.md`** — still has template content from the bootstrap.
- [ ] **Demo dry run** with WARP off, full 15-minute run-of-show.

## 🟢 Future / nice-to-have (post-demo)

- [ ] **Tighten CORS** on the secure Worker before any non-demo use. Currently `Access-Control-Allow-Origin: *`. Production behind Cloudflare Access would restrict to known origins.
- [ ] **`verify-all.sh` honest TLS** — drop `ssl.CERT_NONE`. Was kept for WARP compat but it can no longer catch a bad cert.
- [ ] **Meter UI display nits** (cosmetic):
  - `toFixed(2)` rounds Azure's `0.087/GB` to display `0.09/GB` — same as AWS. Use `toFixed(3)` or render literal.
  - `$1800.00` should render `$1,800` — add comma-grouping to `formatDollars`.
- [ ] **Build manual + run-of-show alignment** — manual still describes the original three-`wrangler.<role>.toml` layout; the implementation note at the top covers KV→R2 but not the env-config refactor.
- [ ] **Audit log retention policy** — R2 audit log grows unbounded. Add a cron-triggered cleanup or a TTL/lifecycle rule before any sustained use.

## Known Gotchas (still relevant)

1. **WARP intercepts TLS** to `*.jsherron.com` from this Mac. Always disconnect (or test from browser/phone) before curling demo subdomains.
2. **CloudFront pool monitor path** must be `/healthcheck.txt` (no `/public/`) because CloudFront's origin path strips `/public/`.
3. **LB pool Host header overrides** — CloudFront's ACM cert only covers `cloudfront-pool.demo.jsherron.com`, so the LB must rewrite Host/SNI to that hostname. Without overrides → 525 on every CloudFront-pool-routed request.
4. **Cloudflare edge caches** repeated curl loops on the same URL. Always cache-bust (`?cb=$i`) when verifying steering or you'll see the same `served-by` from cache forever.
5. **Wrangler auth** — OAuth token expires hourly; `wrangler login` re-auths via browser flow.
6. **Wrangler account selection** — multi-account contexts need `CLOUDFLARE_ACCOUNT_ID=[removed]` exported.
7. **Wrangler Pages deploy default branch** — `wrangler pages deploy` deploys to a *preview* branch named after current git branch unless you pass `--branch=main`. Custom domains are bound to the production deployment, so preview deploys won't be visible at `*.pages.dev`/`*.demo` custom domains.
8. **R2 uploads** — must use `--remote` flag or uploads go to local dev.
9. **DNS propagation** — custom domains take 30–60s after attach.
10. **CloudFront deploys** — 10–15 minutes for distribution updates.
11. **Meter counter** — non-atomic R2 read-modify-write. Concurrent writes may lose a few bytes per hour. Acceptable per build manual.
12. **`verify-all.sh` TLS** — script disables verification globally; useful with WARP, but can't catch bad certs.

## Resource Inventory

See `STATE.md` for full list. Key IDs:
- Zone: `[removed]`
- Account: `[removed]`
- AWS Account: `512629184821`
- R2 Bucket: `multicdn-demo-20260505-2351`
- CloudFront: `E362FEEO2DM9NE`
- ACM Cert (CloudFront-side): `arn:aws:acm:us-east-1:512629184821:certificate/61445144-6bc4-4f98-96ac-950013484a1d`
- Wildcard Cloudflare Edge Cert: `*.demo.jsherron.com` (Advanced)
- KV Namespace (unused): `fdbdbb94864b4fb5bbdc19a011584f0a`
- workers.dev subdomain: `jsherron-test-account.workers.dev`
- Pages CNAMEs: `portal.demo.jsherron.com → multicdn-demo-portal.pages.dev`, `audit.demo.jsherron.com → multicdn-demo-audit.pages.dev`
