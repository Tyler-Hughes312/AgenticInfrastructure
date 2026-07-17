variable "name" {
  type = string
}

variable "connect_invoke_arn" {
  type = string
}

variable "connect_function_name" {
  type = string
}

variable "disconnect_invoke_arn" {
  type = string
}

variable "disconnect_function_name" {
  type = string
}

variable "default_invoke_arn" {
  type = string
}

variable "default_function_name" {
  type = string
}

variable "authorizer_invoke_arn" {
  type = string
}

variable "authorizer_function_name" {
  type = string
}

variable "stage_name" {
  type    = string
  default = "dev"
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "log_retention_days" {
  type    = number
  default = 30
}

data "aws_caller_identity" "current" {}

resource "aws_cloudwatch_log_group" "access" {
  name              = "/aws/apigateway/${var.name}-ws"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_cloudwatch_log_resource_policy" "access" {
  policy_name = "${var.name}-ws-apigw-logs"

  policy_document = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "APIGatewayWrite"
        Effect = "Allow"
        Principal = {
          Service = "apigateway.amazonaws.com"
        }
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "${aws_cloudwatch_log_group.access.arn}:*"
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      },
      {
        Sid    = "DeliveryLogsWrite"
        Effect = "Allow"
        Principal = {
          Service = "delivery.logs.amazonaws.com"
        }
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "${aws_cloudwatch_log_group.access.arn}:*"
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      },
    ]
  })
}

resource "aws_apigatewayv2_api" "ws" {
  name                       = "${var.name}-ws"
  protocol_type              = "WEBSOCKET"
  route_selection_expression = "$request.body.action"
  description                = "Agentic platform WebSocket API"
  tags                       = var.tags
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id                           = aws_apigatewayv2_api.ws.id
  name                             = "cognito-request"
  authorizer_type                  = "REQUEST"
  authorizer_uri                   = var.authorizer_invoke_arn
  identity_sources                 = ["route.request.querystring.token"]
  authorizer_result_ttl_in_seconds = 300
}

resource "aws_apigatewayv2_integration" "connect" {
  api_id                    = aws_apigatewayv2_api.ws.id
  integration_type          = "AWS_PROXY"
  integration_uri           = var.connect_invoke_arn
  integration_method        = "POST"
  content_handling_strategy = "CONVERT_TO_TEXT"
  timeout_milliseconds      = 29000
}

resource "aws_apigatewayv2_integration" "disconnect" {
  api_id                    = aws_apigatewayv2_api.ws.id
  integration_type          = "AWS_PROXY"
  integration_uri           = var.disconnect_invoke_arn
  integration_method        = "POST"
  content_handling_strategy = "CONVERT_TO_TEXT"
  timeout_milliseconds      = 29000
}

resource "aws_apigatewayv2_integration" "default" {
  api_id                    = aws_apigatewayv2_api.ws.id
  integration_type          = "AWS_PROXY"
  integration_uri           = var.default_invoke_arn
  integration_method        = "POST"
  content_handling_strategy = "CONVERT_TO_TEXT"
  # Max for WebSocket Lambda proxy (agent turns)
  timeout_milliseconds = 29000
}

resource "aws_apigatewayv2_route" "connect" {
  api_id             = aws_apigatewayv2_api.ws.id
  route_key          = "$connect"
  target             = "integrations/${aws_apigatewayv2_integration.connect.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "disconnect" {
  api_id    = aws_apigatewayv2_api.ws.id
  route_key = "$disconnect"
  target    = "integrations/${aws_apigatewayv2_integration.disconnect.id}"
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.ws.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.default.id}"
}

resource "aws_apigatewayv2_stage" "this" {
  api_id      = aws_apigatewayv2_api.ws.id
  name        = var.stage_name
  auto_deploy = true
  tags        = var.tags

  # Do not set logging_level — requires account-level API Gateway CloudWatch role.
  default_route_settings {
    detailed_metrics_enabled = true
    throttling_burst_limit   = 50
    throttling_rate_limit    = 25
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access.arn
    format = jsonencode({
      requestId       = "$context.requestId"
      connectionId    = "$context.connectionId"
      eventType       = "$context.eventType"
      routeKey        = "$context.routeKey"
      status          = "$context.status"
      errorMessage    = "$context.error.message"
      authorizerError = "$context.authorizer.error"
    })
  }

  depends_on = [aws_cloudwatch_log_resource_policy.access]
}

resource "aws_lambda_permission" "connect" {
  statement_id  = "AllowAPIGatewayWSConnect"
  action        = "lambda:InvokeFunction"
  function_name = var.connect_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.ws.execution_arn}/*/*"
}

resource "aws_lambda_permission" "disconnect" {
  statement_id  = "AllowAPIGatewayWSDisconnect"
  action        = "lambda:InvokeFunction"
  function_name = var.disconnect_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.ws.execution_arn}/*/*"
}

resource "aws_lambda_permission" "default" {
  statement_id  = "AllowAPIGatewayWSDefault"
  action        = "lambda:InvokeFunction"
  function_name = var.default_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.ws.execution_arn}/*/*"
}

resource "aws_lambda_permission" "authorizer" {
  statement_id  = "AllowAPIGatewayWSAuthorizer"
  action        = "lambda:InvokeFunction"
  function_name = var.authorizer_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.ws.execution_arn}/authorizers/${aws_apigatewayv2_authorizer.cognito.id}"
}

output "api_id" {
  value = aws_apigatewayv2_api.ws.id
}

output "api_endpoint" {
  description = "wss:// endpoint including stage"
  value       = "${aws_apigatewayv2_api.ws.api_endpoint}/${var.stage_name}"
}

output "management_endpoint" {
  description = "HTTPS endpoint for ApiGatewayManagementApi (PostToConnection)"
  # Derive from the API's own endpoint so GovCloud DNS is always correct
  value = "${replace(aws_apigatewayv2_api.ws.api_endpoint, "wss://", "https://")}/${var.stage_name}"
}

output "execution_arn" {
  value = aws_apigatewayv2_api.ws.execution_arn
}

output "access_log_group_arn" {
  value = aws_cloudwatch_log_group.access.arn
}
