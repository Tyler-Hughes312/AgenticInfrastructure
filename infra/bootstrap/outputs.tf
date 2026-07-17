output "state_bucket_name" {
  description = "S3 bucket for remote Terraform state — paste into envs/dev/backend.tf"
  value       = aws_s3_bucket.tfstate.bucket
}

output "state_bucket_arn" {
  description = "ARN of the Terraform state bucket"
  value       = aws_s3_bucket.tfstate.arn
}

output "lock_table_name" {
  description = "DynamoDB table for Terraform state locking — paste into envs/dev/backend.tf"
  value       = aws_dynamodb_table.tf_locks.name
}

output "aws_region" {
  description = "Region where state resources live"
  value       = local.region

}

output "backend_hcl_snippet" {
  description = "Copy into infra/envs/dev/backend.tf"
  value       = <<-EOT
    terraform {
      backend "s3" {
        bucket         = "${aws_s3_bucket.tfstate.bucket}"
        key            = "envs/dev/terraform.tfstate"
        region         = "${local.region}"
        dynamodb_table = "${aws_dynamodb_table.tf_locks.name}"
        encrypt        = true
      }
    }
  EOT
}
