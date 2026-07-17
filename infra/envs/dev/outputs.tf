output "aws_region" {
  value = var.aws_region
}

output "cognito_user_pool_id" {
  value = module.cognito.user_pool_id
}

output "cognito_client_id" {
  value = module.cognito.client_id
}

output "cognito_issuer_url" {
  value = module.cognito.issuer_url
}

output "http_api_endpoint" {
  value = module.api_http.api_endpoint
}

output "websocket_api_endpoint" {
  description = "Connect with wss://.../dev?token=<cognito_jwt>"
  value       = module.api_websocket.api_endpoint
}

output "websocket_management_endpoint" {
  value = module.api_websocket.management_endpoint
}

output "artifacts_bucket_name" {
  value = module.artifacts.bucket_name
}

output "dynamodb_table_names" {
  value = module.dynamodb.table_names
}

output "bedrock_model_id" {
  value = var.bedrock_model_id
}

output "bedrock_model_arn" {
  value = local.bedrock_model_arn
}

output "lambda_function_names" {
  value = {
    rest          = module.lambda_rest.function_name
    ws_authorizer = module.lambda_ws_authorizer.function_name
    ws_connect    = module.lambda_ws_connect.function_name
    ws_disconnect = module.lambda_ws_disconnect.function_name
    ws_default    = module.lambda_ws_default.function_name
  }
}
