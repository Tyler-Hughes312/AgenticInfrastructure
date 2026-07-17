variable "aws_profile" {
  description = "Optional AWS shared-credentials profile (GovCloud). Empty = default chain / env vars."
  type        = string
  default     = ""
}

variable "aws_region" {
  description = "AWS GovCloud region for Terraform state resources"
  type        = string
  default     = "us-gov-west-1"

  validation {
    condition     = var.aws_region == "us-gov-west-1" || var.aws_region == "us-gov-east-1"
    error_message = "Bootstrap must target an AWS GovCloud region."
  }
}

variable "project" {
  description = "Project tag / name prefix"
  type        = string
  default     = "agentic"
}

variable "state_bucket_name" {
  description = "Optional explicit state bucket name. Leave empty to auto-generate from account + region."
  type        = string
  default     = ""
}

variable "lock_table_name" {
  description = "DynamoDB table name for Terraform state locking"
  type        = string
  default     = "agentic-terraform-locks"
}
