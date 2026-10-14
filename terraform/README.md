# Multi-CDN Demo — AWS Terraform (`cloudfront-pool`)

Manages the AWS side of the Multi-CDN demo (`cloudfront-pool.demo.jsherron.com`):

| Resource | Terraform file |
|---|---|
| ACM Certificate (`cloudfront-pool.demo.jsherron.com`) | `acm.tf` |
| CloudFront Response Headers Policy (`served-by: cloudfront`) | `cloudfront.tf` |
| CloudFront Distribution (`cloudfront-pool.demo.jsherron.com` → `cf-pool.demo.jsherron.com`) | `cloudfront.tf` |

## Usage

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Fill in multicdn_demo_secret from 1Password ("AWS CDN Demo — Terraform secrets")
terraform init
terraform plan
```

Or use the top-level helper scripts from the repo root:
- `./scripts/standup.sh`
- `./scripts/teardown.sh`
