output "cloudfront_pool_domain" {
  description = "Update the cloudfront-pool.demo.jsherron.com CNAME in Cloudflare to this value after standup"
  value       = aws_cloudfront_distribution.cloudfront_pool.domain_name
}

output "cloudfront_pool_distribution_id" {
  value = aws_cloudfront_distribution.cloudfront_pool.id
}

output "acm_certificate_arn" {
  value = aws_acm_certificate.cloudfront_pool.arn
}

output "response_headers_policy_id" {
  value = aws_cloudfront_response_headers_policy.served_by_cloudfront.id
}
