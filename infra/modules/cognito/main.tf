variable "name_prefix" {
  description = "Prefix for Cognito resources (e.g. agentic-dev)"
  type        = string
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "password_minimum_length" {
  type    = number
  default = 12
}

resource "aws_cognito_user_pool" "this" {
  name = "${var.name_prefix}-users"

  # Email-as-username. Never redefine standard attributes in schema (apply fails).
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  mfa_configuration = "OFF"

  password_policy {
    minimum_length                   = var.password_minimum_length
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }

  tags = var.tags
}

resource "aws_cognito_user_pool_client" "spa" {
  name         = "${var.name_prefix}-spa"
  user_pool_id = aws_cognito_user_pool.this.id

  generate_secret                               = false
  prevent_user_existence_errors                 = "ENABLED"
  enable_token_revocation                       = true
  enable_propagate_additional_user_context_data = false

  # Password + SRP for app clients; no Hosted UI / OAuth callbacks until hosting ships.
  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_SRP_AUTH",
  ]

  supported_identity_providers = ["COGNITO"]

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_group" "admins" {
  name         = "admins"
  user_pool_id = aws_cognito_user_pool.this.id
  description  = "Administrators"
  precedence   = 1
}

output "user_pool_id" {
  value = aws_cognito_user_pool.this.id
}

output "user_pool_arn" {
  value = aws_cognito_user_pool.this.arn
}

output "user_pool_endpoint" {
  value = aws_cognito_user_pool.this.endpoint
}

output "client_id" {
  value = aws_cognito_user_pool_client.spa.id
}

output "issuer_url" {
  description = "JWT issuer URL for API Gateway JWT authorizer (use Cognito ID token as Bearer)"
  value       = "https://${aws_cognito_user_pool.this.endpoint}"
}
