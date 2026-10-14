# Certificate for the multi-CDN demo CloudFront distribution.
# Must be in us-east-1 for use with CloudFront.
#
# MANUAL STEP ON STANDUP: After apply, ACM will provide a DNS validation CNAME
# that must be added to the Cloudflare zone for demo.jsherron.com before the
# certificate will issue. Check with:
#   aws acm describe-certificate --region us-east-1 \
#     --certificate-arn <arn> \
#     --query 'Certificate.DomainValidationOptions'

resource "aws_acm_certificate" "cloudfront_pool" {
  provider = aws.us_east_1

  domain_name       = "cloudfront-pool.demo.jsherron.com"
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}
