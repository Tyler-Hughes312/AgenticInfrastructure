variable "aws_profile" {
  description = "Optional AWS shared-credentials profile (GovCloud). Empty = default chain / env vars."
  type        = string
  default     = ""
}

variable "aws_region" {
  description = "AWS GovCloud region"
  type        = string
  default     = "us-gov-west-1"

  validation {
    condition     = var.aws_region == "us-gov-west-1"
    error_message = "This stack is fixed to us-gov-west-1 (GovCloud West)."
  }
}

variable "project" {
  type    = string
  default = "agentic"
}

variable "env" {
  type    = string
  default = "dev"
}

variable "bedrock_model_id" {
  description = "Bedrock foundation model ID for GPT-OSS-120b"
  type        = string
  default     = "openai.gpt-oss-120b-1:0"
}

variable "lambda_rest_timeout" {
  type    = number
  default = 29
}

variable "lambda_ws_timeout" {
  type    = number
  default = 60
}

variable "artifacts_force_destroy" {
  type    = bool
  default = true
}
