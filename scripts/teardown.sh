#!/usr/bin/env bash
# Multi-CDN Demo — Teardown Script
# Destroys the CloudFront distribution and/or Cloudflare Workers when the demo is not in use.
# Leaves the ACM certificate and R2 bucket intact so standup is fast and requires no DNS re-validation.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:?Set CLOUDFLARE_ACCOUNT_ID in your environment}"

echo "This will tear down the Multi-CDN demo (CloudFront distribution + 5 Workers)."
echo "The ACM certificate and R2 bucket (multicdn-demo-20260505-2351) are preserved."
echo "Proceed with teardown? (yes/no)"
read -r CONFIRM
if [ "$CONFIRM" != "yes" ]; then
	echo "Aborted."
	exit 1
fi

echo "==> Destroying AWS CloudFront distribution..."
terraform -chdir="$ROOT_DIR/terraform" destroy \
	-target=aws_cloudfront_distribution.cloudfront_pool \
	-auto-approve

echo "==> Deleting Cloudflare Workers..."
cd "$ROOT_DIR"
for env_name in public secure meter portal audit; do
	npx wrangler delete --env "$env_name" --force || true
done

echo "==> Teardown complete. Run ./scripts/standup.sh to restore."
