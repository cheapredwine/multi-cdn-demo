#!/usr/bin/env bash
# Multi-CDN Demo — Standup Script
# Ensures AWS CloudFront pool (Terraform) and all 5 Cloudflare Workers are deployed,
# then runs end-to-end verification.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-[removed]}"

echo "==> Verifying AWS access..."
aws sts get-caller-identity >/dev/null

echo "==> Applying AWS Terraform (ACM + CloudFront pool)..."
terraform -chdir="$ROOT_DIR/terraform" init -input=false
terraform -chdir="$ROOT_DIR/terraform" apply -auto-approve

echo "==> Deploying all 5 Cloudflare Workers..."
cd "$ROOT_DIR"
npm run deploy:all

echo "==> Ensuring JWT_SECRET is set on secure Worker..."
openssl rand -base64 32 | npx wrangler secret put JWT_SECRET --env secure

CF_POOL_DOMAIN=$(terraform -chdir="$ROOT_DIR/terraform" output -raw cloudfront_pool_domain)
echo ""
echo "==> CloudFront pool domain: $CF_POOL_DOMAIN"
echo "    (If CloudFront was recreated, ensure the cloudfront-pool.demo.jsherron.com CNAME points to $CF_POOL_DOMAIN)"
echo ""

echo "==> Running end-to-end verification..."
"$ROOT_DIR/scripts/verify-all.sh"
