data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

locals {
  name_prefix = "${var.project}-${var.env}"
  account_id  = data.aws_caller_identity.current.account_id
  partition   = data.aws_partition.current.partition
  region      = data.aws_region.current.name

  bedrock_model_arn = "arn:${local.partition}:bedrock:${local.region}::foundation-model/${var.bedrock_model_id}"
  # GovCloud geo cross-region inference profile id (optional invoke target)
  bedrock_geo_profile_arn = "arn:${local.partition}:bedrock:${local.region}:${local.account_id}:inference-profile/us-gov.${var.bedrock_model_id}"

  common_env = {
    AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1"
    PROJECT                             = var.project
    ENV                                 = var.env
    BEDROCK_MODEL_ID                    = var.bedrock_model_id
    TABLE_RUNS                          = module.dynamodb.table_names["runs"]
    TABLE_CHECKPOINTS                   = module.dynamodb.table_names["checkpoints"]
    TABLE_WS_CONNECTIONS                = module.dynamodb.table_names["ws-connections"]
    TABLE_USERS                         = module.dynamodb.table_names["users"]
    ARTIFACTS_BUCKET                    = module.artifacts.bucket_name
    COGNITO_USER_POOL_ID                = module.cognito.user_pool_id
    COGNITO_CLIENT_ID                   = module.cognito.client_id
    COGNITO_ISSUER_URL                  = module.cognito.issuer_url
  }

  # Full app policy: all tables + artifacts + Bedrock
  app_data_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DynamoDBAccess"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
          "dynamodb:DescribeTable",
        ]
        Resource = concat(
          module.dynamodb.table_arn_list,
          [for arn in module.dynamodb.table_arn_list : "${arn}/index/*"]
        )
      },
      {
        Sid    = "S3ArtifactsObjects"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
        ]
        Resource = ["${module.artifacts.bucket_arn}/*"]
      },
      {
        Sid      = "S3ArtifactsList"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [module.artifacts.bucket_arn]
      },
      {
        Sid    = "BedrockInvoke"
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
        ]
        Resource = [
          local.bedrock_model_arn,
          local.bedrock_geo_profile_arn,
          "arn:${local.partition}:bedrock:${local.region}:${local.account_id}:inference-profile/*",
        ]
      },
    ]
  })

  # $connect / $disconnect only need the connections table
  ws_connections_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "WsConnectionsTable"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:DescribeTable",
        ]
        Resource = [module.dynamodb.table_arns["ws-connections"]]
      },
    ]
  })
}

module "labeling" {
  source  = "../../modules/labeling"
  project = var.project
  env     = var.env
}

module "cognito" {
  source      = "../../modules/cognito"
  name_prefix = local.name_prefix
  tags        = module.labeling.tags
}

module "dynamodb" {
  source      = "../../modules/dynamodb"
  name_prefix = local.name_prefix
  tags        = module.labeling.tags
}

module "artifacts" {
  source        = "../../modules/artifacts_s3"
  name_prefix   = "${local.name_prefix}-${local.account_id}"
  force_destroy = var.artifacts_force_destroy
  tags          = module.labeling.tags
}

module "lambda_rest" {
  source      = "../../modules/lambda_fn"
  name        = "${local.name_prefix}-rest"
  description = "HTTP API handler"
  source_dir  = "${path.module}/../../lambda/rest"
  timeout     = var.lambda_rest_timeout
  memory_size = 512
  environment = local.common_env
  policy_json = local.app_data_policy
  tags        = module.labeling.tags
}

module "lambda_ws_authorizer" {
  source      = "../../modules/lambda_fn"
  name        = "${local.name_prefix}-ws-auth"
  description = "WebSocket Cognito REQUEST authorizer"
  source_dir  = "${path.module}/../../lambda/ws_authorizer"
  timeout     = 10
  memory_size = 256
  environment = {
    COGNITO_ISSUER_URL = module.cognito.issuer_url
    COGNITO_CLIENT_ID  = module.cognito.client_id
  }
  tags = module.labeling.tags
}

module "lambda_ws_connect" {
  source      = "../../modules/lambda_fn"
  name        = "${local.name_prefix}-ws-connect"
  description = "WebSocket $connect"
  source_dir  = "${path.module}/../../lambda/ws_connect"
  timeout     = 15
  memory_size = 256
  environment = local.common_env
  policy_json = local.ws_connections_policy
  tags        = module.labeling.tags
}

module "lambda_ws_disconnect" {
  source      = "../../modules/lambda_fn"
  name        = "${local.name_prefix}-ws-disconnect"
  description = "WebSocket $disconnect"
  source_dir  = "${path.module}/../../lambda/ws_disconnect"
  timeout     = 15
  memory_size = 256
  environment = local.common_env
  policy_json = local.ws_connections_policy
  tags        = module.labeling.tags
}

module "lambda_ws_default" {
  source      = "../../modules/lambda_fn"
  name        = "${local.name_prefix}-ws-default"
  description = "WebSocket $default (agent turns / Bedrock)"
  source_dir  = "${path.module}/../../lambda/ws_default"
  timeout     = var.lambda_ws_timeout
  memory_size = 1024
  # Management URL is derived at runtime from requestContext (avoids circular dep with api_websocket)
  environment = local.common_env
  policy_json = local.app_data_policy
  tags        = module.labeling.tags
}

module "api_http" {
  source               = "../../modules/api_http"
  name                 = local.name_prefix
  lambda_invoke_arn    = module.lambda_rest.invoke_arn
  lambda_function_name = module.lambda_rest.function_name
  cognito_issuer_url   = module.cognito.issuer_url
  cognito_client_id    = module.cognito.client_id
  tags                 = module.labeling.tags
}

module "api_websocket" {
  source                   = "../../modules/api_websocket"
  name                     = local.name_prefix
  stage_name               = var.env
  connect_invoke_arn       = module.lambda_ws_connect.invoke_arn
  connect_function_name    = module.lambda_ws_connect.function_name
  disconnect_invoke_arn    = module.lambda_ws_disconnect.invoke_arn
  disconnect_function_name = module.lambda_ws_disconnect.function_name
  default_invoke_arn       = module.lambda_ws_default.invoke_arn
  default_function_name    = module.lambda_ws_default.function_name
  authorizer_invoke_arn    = module.lambda_ws_authorizer.invoke_arn
  authorizer_function_name = module.lambda_ws_authorizer.function_name
  tags                     = module.labeling.tags
}

# Allow $default Lambda to PostToConnection on this API
resource "aws_iam_role_policy" "ws_default_manage_connections" {
  name = "${local.name_prefix}-ws-manage-connections"
  role = module.lambda_ws_default.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ManageConnections"
        Effect   = "Allow"
        Action   = ["execute-api:ManageConnections"]
        Resource = "${module.api_websocket.execution_arn}/${var.env}/POST/@connections/*"
      },
    ]
  })
}
