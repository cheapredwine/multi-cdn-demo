# Fix: `assets.demo.jsherron.com` LB hostname

**Status:** ✅ **Resolved 2026-05-06T20:30Z.** All three issues fixed in sequence — kept here as a runbook for future reference.

## Resolution summary

The LB hostname needed three fixes layered on top of each other:

| Phase | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | TLS error / 525 SSL handshake failed at the edge | No SSL cert covered the LB hostname (LB virtual hostnames invisible to Universal SSL) | Order Advanced Certificate for `*.demo.jsherron.com` |
| 2 | Cloudflare Error 1000 / Pool degraded | CloudFront pool's health monitor was probing `/public/healthcheck.txt`; CloudFront's origin path adds `/public` so the request resolved to a missing key | Set monitor path to `/healthcheck.txt` (no `public/` prefix) for the cloudfront pool only |
| 3 | 525 on production traffic; pool monitors green | LB sent inbound SNI/Host (`assets.demo.jsherron.com`) to pool origins; CloudFront's ACM cert only covers `cloudfront-pool.demo.jsherron.com` so its TLS handshake failed | Set **Host header override** on each pool to its origin hostname (`cf-pool.demo.jsherron.com` and `cloudfront-pool.demo.jsherron.com`) |

After all three: 200s return on `https://assets.demo.jsherron.com/images/...` with `served-by` headers alternating between `cf-edge` and `cloudfront` per request.

---

(Original diagnosis preserved below for reference.)

---

**Original symptom:** `curl -sI https://assets.demo.jsherron.com/public/images/logo.png` (with WARP off) returned a TLS error or `525 SSL handshake failed`.

---

## Why

Cloudflare's **Universal SSL** scans the zone's DNS records and provisions edge certificates for what it finds. **Load Balancer virtual hostnames are not in the DNS zone** — they're managed by the LB service itself — so Universal SSL never discovers `assets.demo.jsherron.com` and never issues a cert for it.

A few related certs exist on the zone (`*.cf-pool.demo`, `*.meter.demo`, `*.secure.demo`) from earlier dashboard work, but none of them cover `assets.demo`. The build manual itself flagged this in Phase 5:

> Load Balancer hostnames **do not** automatically get SSL certificates. Unlike Workers or R2 custom domains (which auto-provision), LB virtual hostnames aren't visible to Universal SSL's DNS scanner.

So the fix is one-time: order an Advanced Certificate that covers the hostname.

---

## Fix (recommended): one wildcard for all demo subdomains

This replaces the three subdomain-specific certs and prevents the same gap from happening if you add new `*.demo` hostnames later.

### Option A — Dashboard (5 min)

1. Cloudflare → **jsherron.com** zone → **SSL/TLS → Edge Certificates**
2. (Optional, cleaner) Delete the existing demo-scoped certs:
   - `*.cf-pool.demo.jsherron.com`
   - `*.meter.demo.jsherron.com`
   - `*.secure.demo.jsherron.com`
   Do **not** delete Universal SSL or any apex certificate. The wildcard you're about to create will supersede the three.
3. Click **Order Advanced Certificate**.
4. Hostnames: `*.demo.jsherron.com`, `demo.jsherron.com`
5. Validation method: **TXT** (works for wildcards; HTTP doesn't).
6. Validity: 90 days. Certificate Authority: Google or Let's Encrypt — either works.
7. Submit. Status moves `pending_validation` → `active` in 1–2 minutes.

This single cert then covers:

| Hostname | Currently covered by | After wildcard |
|---|---|---|
| `assets.demo.jsherron.com` (LB) | **nothing** ← the bug | wildcard ✓ |
| `cf-pool.demo.jsherron.com` | `*.cf-pool.demo` (overlap) | wildcard ✓ |
| `cloudfront-pool.demo.jsherron.com` | ACM cert on CloudFront | wildcard ✓ (Cloudflare-edge side) |
| `secure.demo.jsherron.com` | `*.secure.demo` (overlap) | wildcard ✓ |
| `meter.demo.jsherron.com` | `*.meter.demo` (overlap) | wildcard ✓ |
| `portal.demo.jsherron.com` | per-domain Pages cert | wildcard ✓ (Pages cert kept too) |
| `audit.demo.jsherron.com` | per-domain Pages cert | wildcard ✓ |

### Option B — API (preferred if scripted)

Requires a token with `Zone › SSL and Certificates › Edit` for `jsherron.com`. The OAuth token wrangler uses today does **not** have this scope effectively (the listed scope returns 9109 unauthorized at zone level — see prior PR description).

Create a zone-scoped API token at https://dash.cloudflare.com/profile/api-tokens:

- Permissions: `Zone › SSL and Certificates › Edit`, `Zone › Zone › Read`
- Zone resources: include `jsherron.com`

Then:

```bash
export CLOUDFLARE_API_TOKEN=<the new token>
export ZONE=[removed]

curl -sX POST "https://api.cloudflare.com/client/v4/zones/$ZONE/ssl/certificate_packs/order" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "advanced",
    "hosts": ["*.demo.jsherron.com", "demo.jsherron.com"],
    "validation_method": "txt",
    "validity_days": 90,
    "certificate_authority": "google",
    "cloudflare_branding": false
  }' | python3 -m json.tool
```

Successful response shows `"status": "pending_validation"` and a TXT validation record that's auto-installed in Cloudflare DNS (since the zone is on Cloudflare). Validation typically completes in 1–2 minutes.

Poll status:

```bash
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE/ssl/certificate_packs?status=all" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | \
  python3 -c "import json, sys; [print(f\"{p['hosts']}  {p['status']}\") for p in json.load(sys.stdin)['result']]"
```

Wait until the line containing `*.demo.jsherron.com` shows `active`.

---

## Verification

WARP intercepts TLS to `*.jsherron.com` from this Mac, so verify either from a non-WARP context (browser, phone, colleague's machine) or by disconnecting first:

```bash
warp-cli disconnect

# Should return HTTP 200, no TLS warning, served-by header present
curl -sI https://assets.demo.jsherron.com/public/images/logo.png | head -10

# 10 requests should mix cf-edge / cloudfront roughly 50/50
for i in {1..10}; do
  curl -sI https://assets.demo.jsherron.com/public/images/logo.png | grep -i served-by
done

warp-cli connect
```

Expected output of the loop, with both pools healthy:

```
served-by: cf-edge
served-by: cloudfront
served-by: cloudfront
served-by: cf-edge
...
```

If you see only `cf-edge`, the CloudFront pool is unhealthy — check its monitor path is `/healthcheck.txt` (no `/public/` prefix; CloudFront's origin path adds it). If you see only `cloudfront`, the Cloudflare pool's monitor is failing — confirm the public-steering Worker is deployed (`wrangler deployments list --env public`) and serving `/public/healthcheck.txt`.

If TLS still fails after the cert is `active`:
- Wait another minute; edge propagation can lag the API status by ~60 seconds.
- Check there isn't a stuck SSL/TLS mode mismatch: Zone → SSL/TLS → Overview should show **Full (strict)** for the LB origins to negotiate cleanly.

---

## Fallbacks if the cert can't be ordered before the demo

Both fallbacks bypass `assets.demo` entirely. The customer doesn't see them, but the SE knows the demo isn't running through the LB.

1. **Run Beat 2 against pool hostnames directly.** `cf-pool.demo.jsherron.com` and `cloudfront-pool.demo.jsherron.com` already have working SSL. Show two terminal panes, one curl loop each, narrate the multi-CDN story manually. The narrative loses the "LB makes failover operational" punch but keeps the "single origin, two CDNs" point.

2. **Run against the public-steering worker's `workers.dev` URL.** `multicdn-demo-public-steering.jsherron-test-account.workers.dev` is reachable today and has a Cloudflare-managed cert independent of the zone. Same caveat: this is the CF pool only, not the LB.

The portal and audit Pages also have working `*.pages.dev` URLs as fallbacks.

---

## Definition of done

- [x] Wildcard `*.demo.jsherron.com` cert provisioned and `active`
- [ ] `curl -sI https://assets.demo.jsherron.com/public/images/logo.png` returns HTTP 200 (currently Error 1000 — see Phase 2 below)
- [ ] 10x curl loop shows both `served-by: cf-edge` and `served-by: cloudfront`
- [ ] Browser navigation to `https://assets.demo.jsherron.com/public/images/logo.png` shows the image with no security warning
- [ ] `STATE.md` and `HANDOFF.md` updated to mark this issue closed
- [ ] (Optional) The three superseded subdomain certs deleted

---

# Phase 2: Cloudflare Error 1000 — DNS points to prohibited IP

After the cert was ordered and TLS started working, the next layer surfaced. Cloudflare returns:

```
Error 1000 — DNS points to prohibited IP
Ray ID: 9f7aa2d008016a4a (or similar)
```

This means the DNS record for `assets.demo.jsherron.com` resolves to an IP/target Cloudflare refuses to proxy.

## Why

> **Update 2026-05-06T20:13Z:** Confirmed no `assets` DNS record exists in the zone. `STATE.md` was wrong — the row showing `CNAME → LB hostname` was the previous agent's intent, not the current state. The cause must therefore be one of:
>
> 1. **A wildcard `*.demo.jsherron.com` CNAME** is catching the hostname and pointing somewhere prohibited (e.g. into Cloudflare's IP space, or back into the zone).
> 2. **The Load Balancer was deleted or its hostname was changed**, but public DNS / local resolver caches still send the name to a Cloudflare anycast IP. That edge IP receives the request, finds no SNI/Host configuration for it, and returns 1000.
> 3. **The Load Balancer still exists with that hostname, and its auto-managed DNS still resolves correctly,** but the DNS UI hides LB-managed records (UI behavior varies by Cloudflare version) — meaning "no record visible" doesn't mean "no record exists." However, this option doesn't explain Error 1000; if the LB were healthy and resolving, the request would hit it.
>
> **Most likely:** option 1 (wildcard) or option 2 (LB deleted/misconfigured).

For context on why a CNAME is the wrong answer in the first place: a **proxied Cloudflare Load Balancer with a virtual hostname** registers itself as the authoritative DNS for that hostname automatically. You don't and must not also create a CNAME pointing at it. The original `STATE.md` row implied a manual CNAME, which would have produced a self-reference / loop, also resulting in Error 1000.

## Fix

### Step 1 — Discriminate between the three causes

```bash
# What does public DNS see?
dig +short assets.demo.jsherron.com
dig +short assets.demo.jsherron.com CNAME

# Same query against Cloudflare's authoritative resolver, bypassing caches
dig @1.1.1.1 +short assets.demo.jsherron.com
```

Then in dashboard, **Traffic → Load Balancing**: is the `assets.demo.jsherron.com` LB listed?

**If `dig` returns Cloudflare anycast IPs (104.16.x / 104.18.x) AND the LB exists and is healthy:**
- The LB's auto-managed DNS is working. Error 1000 must be coming from a configuration mismatch *inside* the LB. Open the LB and check the hostname is exactly `assets.demo.jsherron.com`. If it's `assets` (no FQDN) or differs in any way, fix it. Check both pools' origins resolve to non-Cloudflare-proxied targets.

**If `dig` returns nothing AND no LB exists:**
- Recreate the LB (Step 2 below). The hostname needs to be claimed by an LB or DNS record before it can serve.

**If `dig` returns nothing but an LB does exist:**
- The LB's hostname is wrong. Open the LB; correct the hostname field; save.

**If `dig` returns Cloudflare IPs but no LB exists, and DNS UI shows no record either:**
- A wildcard CNAME is intercepting. Search DNS records for `*.demo.jsherron.com`. If found and proxied, that's the culprit. Either change it to DNS-only (gray cloud) or remove it; both stop the wildcard from intercepting `assets`.

### Step 2 — Recreate the LB if needed

If the LB is gone:

1. **Traffic → Load Balancing → Create Load Balancer**
2. Hostname: `assets.demo.jsherron.com`
3. Pools (default order): `pool-cf-20260505-2351`, `pool-cloudfront-20260505-2351`
4. Fallback pool: `pool-cf-20260505-2351`
5. Steering policy: **Random** with weights (50/50)
6. Session affinity: none
7. Proxy: **Proxied**
8. Save. Wait ~15–30 seconds for DNS to reflect.

If the **pools** are gone too (they were also created via dashboard per `STATE.md`), recreate them first per build manual Phase 5:

- `pool-cf-20260505-2351`: origin `cf-pool.demo.jsherron.com`, weight 1, monitor: HTTPS GET `/public/healthcheck.txt`, expect 200, body contains `ok`
- `pool-cloudfront-20260505-2351`: origin `cloudfront-pool.demo.jsherron.com`, weight 1, monitor: HTTPS GET `/healthcheck.txt` (no `/public/` because CloudFront's origin path adds it)

### Verify

```bash
warp-cli disconnect

# DNS — should resolve to a Cloudflare anycast IP via the LB
dig +short assets.demo.jsherron.com

# HTTP — should be 200, no Error 1000
curl -sI https://assets.demo.jsherron.com/public/images/logo.png | head -5

# Steering — both CDNs should appear
for i in {1..10}; do
  curl -sI https://assets.demo.jsherron.com/public/images/logo.png | grep -i served-by
done

warp-cli connect
```

If `dig` returns nothing or `NXDOMAIN`, the LB isn't auto-publishing DNS for the hostname. Check the LB's hostname field; if it's `assets.demo` (not the FQDN), correct it.

### If you still see Error 1000 after deleting the CNAME

- The LB hostname might be misconfigured to point at another LB or proxied record. Check **Traffic → Load Balancing → assets.demo.jsherron.com → Pools** — origins must be hostnames that resolve to non-Cloudflare IPs (your CloudFront pool's `*.cloudfront.net` is fine; the CF pool's `cf-pool.demo.jsherron.com` is also fine because R2 custom domains aren't subject to the same prohibition).
- One of the pool origins might itself be misconfigured as a Cloudflare proxied hostname pointing back into the zone. Inspect each pool's origin: `cf-pool.demo.jsherron.com` is OK (R2 custom domain); `cloudfront-pool.demo.jsherron.com` resolves via the gray-cloud CNAME to CloudFront, which is OK.

### Phase 2 definition of done

- [ ] `dig +short assets.demo.jsherron.com` returns Cloudflare anycast IPs (`104.16.x.x` / `104.18.x.x`)
- [ ] HTTP 200 with `served-by` header
- [ ] 50/50 mix of `cf-edge` and `cloudfront` over 10 requests
- [ ] No Cloudflare error pages

After Phase 2 closes, the demo is fully ready.
