variable "name" {
  description = "Lambda function name"
  type        = string
}

variable "description" {
  type    = string
  default = ""
}

variable "handler" {
  type    = string
  default = "index.handler"
}

variable "runtime" {
  type    = string
  default = "nodejs20.x"
}

variable "architectures" {
  type    = list(string)
  default = ["arm64"]
}

variable "timeout" {
  type    = number
  default = 30
}

variable "memory_size" {
  type    = number
  default = 512
}

variable "source_dir" {
  description = "Directory containing Lambda source (zipped via archive_file)"
  type        = string
}

variable "environment" {
  type    = map(string)
  default = {}
}

variable "policy_json" {
  description = "Inline IAM policy document JSON for extra permissions (optional)"
  type        = string
  default     = null
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "log_retention_days" {
  type    = number
  default = 30
}

data "archive_file" "src" {
  type        = "zip"
  source_dir  = var.source_dir
  output_path = "${path.module}/builds/${var.name}.zip"
}

data "aws_partition" "current" {}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/${var.name}"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_iam_role" "this" {
  name = "${var.name}-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "basic" {
  role       = aws_iam_role.this.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "extra" {
  count = var.policy_json != null ? 1 : 0

  name   = "${var.name}-extra"
  role   = aws_iam_role.this.id
  policy = var.policy_json
}

resource "aws_lambda_function" "this" {
  function_name = var.name
  description   = var.description
  role          = aws_iam_role.this.arn
  handler       = var.handler
  runtime       = var.runtime
  architectures = var.architectures
  timeout       = var.timeout
  memory_size   = var.memory_size

  filename         = data.archive_file.src.output_path
  source_code_hash = data.archive_file.src.output_base64sha256

  environment {
    variables = var.environment
  }

  depends_on = [
    aws_cloudwatch_log_group.this,
    aws_iam_role_policy_attachment.basic,
    aws_iam_role_policy.extra,
  ]

  tags = var.tags
}

output "function_name" {
  value = aws_lambda_function.this.function_name
}

output "function_arn" {
  value = aws_lambda_function.this.arn
}

output "invoke_arn" {
  value = aws_lambda_function.this.invoke_arn
}

output "role_arn" {
  value = aws_iam_role.this.arn
}

output "role_name" {
  value = aws_iam_role.this.name
}
