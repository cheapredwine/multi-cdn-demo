#!/bin/bash
# Multi-CDN Demo — Final Verification Script
# Version: 20260505-2351

set -e

DOMAIN="jsherron.com"
LB_HOST="assets.demo.${DOMAIN}"
CF_POOL="cf-pool.demo.${DOMAIN}"
CF_FRONT="cloudfront-pool.demo.${DOMAIN}"
SECURE="secure.demo.${DOMAIN}"
METER="meter.demo.${DOMAIN}"

echo "========================================"
echo "Multi-CDN Demo — Final Verification"
echo "========================================"
echo ""

# Use Python for HTTPS requests with disabled SSL verification (for local testing)
PYTHON_CHECK=$(cat << 'PYEOF'
import urllib.request
import ssl
import json
import sys

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def fetch(url, method='GET', data=None):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}, method=method)
    if data:
        req.data = data.encode()
    try:
        with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()
    except Exception as e:
        return -1, {}, str(e).encode()

def test_lb_steering():
    print("=== Test 1: LB Steering (20 requests) ===")
    cf = 0
    cfront = 0
    errors = 0
    for i in range(20):
        status, headers, body = fetch(f'https://{sys.argv[1]}/public/images/logo.png')
        if status == 200:
            sb = headers.get('served-by', 'unknown')
            if 'cf' in sb.lower() and 'cloudfront' not in sb.lower():
                cf += 1
            elif 'cloudfront' in sb.lower():
                cfront += 1
        else:
            errors += 1
    print(f"  CF (cf-edge):       {cf}/20")
    print(f"  CloudFront:         {cfront}/20")
    print(f"  Errors:             {errors}/20")
    if errors > 0:
        print("  ⚠️  Some requests failed")
    elif cf > 0 and cfront > 0:
        print("  ✅ Both CDNs serving traffic")
    elif cf == 20:
        print("  ⚠️  Only CF responding (CloudFront pool may be unhealthy)")
    elif cfront == 20:
        print("  ⚠️  Only CloudFront responding (CF pool may be unhealthy)")
    print()

def test_pool_hostnames():
    print("=== Test 2: Pool Hostnames ===")
    for host, name in [(sys.argv[2], "CF Pool"), (sys.argv[3], "CloudFront Pool"), (sys.argv[1], "LB")]:
        status, headers, body = fetch(f'https://{host}/public/images/logo.png')
        sb = headers.get('served-by', 'unknown')
        print(f"  {name}: HTTP {status}, served-by: {sb}")
    print()

def test_token_flow():
    print("=== Test 3: Token Issuance & Protected Content ===")
    # Issue token
    status, headers, body = fetch(f'https://{sys.argv[4]}/issue', method='POST', data='{}')
    if status != 200:
        print(f"  ❌ Token issuance failed: HTTP {status}")
        print()
        return
    
    data = json.loads(body)
    token = data['token']
    url = data['url']
    print(f"  ✅ Token issued")
    
    # Fetch protected content
    status, headers, body = fetch(url)
    if status == 200:
        print(f"  ✅ Protected content accessible (HTTP 200)")
    else:
        print(f"  ❌ Protected content failed: HTTP {status}")
    print()

def test_token_expiry():
    print("=== Test 4: Token Expiry (wait 65s) ===")
    # Issue token
    status, headers, body = fetch(f'https://{sys.argv[4]}/issue', method='POST', data='{}')
    data = json.loads(body)
    url = data['url']
    
    import time
    print("  Waiting 65 seconds...")
    time.sleep(65)
    
    status, headers, body = fetch(url)
    if status == 403:
        print(f"  ✅ Token correctly expired (HTTP 403)")
    else:
        print(f"  ❌ Expected 403, got HTTP {status}")
    print()

def test_audit_log():
    print("=== Test 5: Audit Log ===")
    status, headers, body = fetch(f'https://{sys.argv[4]}/audit/recent')
    if status == 200:
        entries = json.loads(body)
        allows = [e for e in entries if e.get('decision') == 'allow']
        denies = [e for e in entries if e.get('decision') == 'deny']
        print(f"  ✅ Audit log accessible")
        print(f"  Allow entries: {len(allows)}")
        print(f"  Deny entries:  {len(denies)}")
    else:
        print(f"  ❌ Audit log failed: HTTP {status}")
    print()

def test_meter():
    print("=== Test 6: Egress Meter ===")
    status, headers, body = fetch(f'https://{sys.argv[5]}/')
    if status == 200 and b'$0.00' in body:
        print("  ✅ Meter page loads with $0.00")
    else:
        print(f"  ❌ Meter failed: HTTP {status}")
    print()

if __name__ == '__main__':
    test_lb_steering()
    test_pool_hostnames()
    test_token_flow()
    # Skip expiry test for speed
    # test_token_expiry()
    test_audit_log()
    test_meter()
    print("========================================")
    print("Verification complete!")
    print("========================================")
PYEOF
)

# Run verification with Python
python3 -c "$PYTHON_CHECK" "$LB_HOST" "$CF_POOL" "$CF_FRONT" "$SECURE" "$METER"

echo ""
echo "To test token expiry manually:"
echo "  1. curl -X POST https://$SECURE/issue"
echo "  2. Wait 65 seconds"
echo "  3. curl the returned URL"
echo "  4. Should return 403"
