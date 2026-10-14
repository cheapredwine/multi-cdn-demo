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

echo "==> Running end-to-end verification..."
"$ROOT_DIR/scripts/verify-all.sh"
