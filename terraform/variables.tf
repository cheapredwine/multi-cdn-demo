variable "multicdn_demo_secret" {
  description = "Value of the X-Multicdn-Demo-Secret header sent from CloudFront to the R2 origin"
  type        = string
  sensitive   = true
}
