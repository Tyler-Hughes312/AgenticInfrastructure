# GovCloud AWS Terraform Deployment Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision a fully active AWS GovCloud (`us-gov-west-1`) backend for the Agentic Platform — Cognito auth, API Gateway HTTP + WebSocket, Lambdas, DynamoDB, S3 artifacts, and Bedrock `openai.gpt-oss-120b-1:0` — with remote Terraform state, and **without** deploying frontend hosting.

**Architecture:** Bootstrap root creates the S3 state bucket + DynamoDB lock table once (local state). Dev root uses that remote backend and composes focused modules for Cognito, DynamoDB, API Gateway, Lambdas, artifacts S3, and least-privilege Bedrock IAM. No VPC, no RDS/Postgres, no RAG services, no CloudFront/Amplify/S3 website.

**Tech Stack:** Terraform >= 1.5, AWS provider ~> 5.0, Node.js 20 Lambda runtimes, API Gateway HTTP API + WebSocket API, Cognito User Pool, DynamoDB, S3, Amazon Bedrock (GovCloud).

## Global Constraints

- Region: `us-gov-west-1` only (AWS GovCloud US-West)
- Partition ARNs use `aws-us-gov`
- Single environment: `dev`
- Bedrock model: `openai.gpt-oss-120b-1:0` (in-region invoke)
- No RAG: no OpenSearch, Bedrock Knowledge Bases, vector indexes, or embedding pipelines
- No hosting deploy: no CloudFront, Amplify, S3 static website, Route53 app DNS
- No VPC / NAT / private subnets
- Persistence: DynamoDB only (no Postgres/RDS/Aurora)
- Cognito: User Pool email/password only (no Hosted UI, no social IdPs)
- Remote state: S3 + DynamoDB lock in the same account/region
- Frontend hosting is deferred; API + auth + data plane are in scope

---

## Locked Decisions

| Decision | Choice |
|---|---|
| Compute | API Gateway HTTP + WebSocket → Lambdas |
| Data store | DynamoDB (replaces Postgres checkpoints) |
| Networking | No VPC |
| Auth | Cognito User Pool (email/password JWTs) |
| State | S3 bucket + DynamoDB lock table |
| Env | Single `dev` |
| LLM | Bedrock GPT-OSS-120b |
| Hosting | Not deployed in this cut |

---

## Repository Layout

```
infra/
  bootstrap/                 # One-time: state bucket + lock table (local state)
    versions.tf
    variables.tf
    main.tf
    outputs.tf
  modules/
    labeling/                # Common tags
    cognito/
    dynamodb/
    artifacts_s3/
    lambda_fn/               # Reusable Lambda + IAM role
    api_http/
    api_websocket/
  envs/dev/
    versions.tf
    backend.tf               # Remote state (filled after bootstrap)
    variables.tf
    main.tf
    outputs.tf
    terraform.tfvars.example
  lambda/
    rest/index.mjs
    ws_connect/index.mjs
    ws_default/index.mjs
    ws_disconnect/index.mjs
    ws_authorizer/index.mjs
docs/superpowers/plans/2026-07-17-govcloud-aws-terraform.md
```

---

## Architecture

```
Clients
  │  Cognito JWT (email/password)
  ▼
API Gateway HTTP API  ──JWT authorizer──► Lambda: rest-api
API Gateway WebSocket ─Lambda authorizer► Lambda: ws-connect / ws-default / ws-disconnect
                                              │
                         ┌────────────────────┼────────────────────┐
                         ▼                    ▼                    ▼
                    DynamoDB              Bedrock              S3 artifacts
                 runs / checkpoints    gpt-oss-120b         lambda zips +
                 connections / users   InvokeModel          run blobs
```

**Terraform state flow**

1. `terraform -chdir=infra/bootstrap apply` → creates state bucket + lock table (local statefile in bootstrap, gitignored).
2. Copy backend config into `infra/envs/dev/backend.tf` from bootstrap outputs.
3. `terraform -chdir=infra/envs/dev init` → migrates/uses remote state; every subsequent apply updates that statefile as resources change.

---

## Full Resource Breakdown

### Bootstrap (`infra/bootstrap`)

| Resource | Name pattern | Purpose |
|---|---|---|
| `aws_s3_bucket` | `agentic-tfstate-{account}-{region}` | Remote Terraform state |
| `aws_s3_bucket_versioning` | enabled | State history / recovery |
| `aws_s3_bucket_server_side_encryption_configuration` | AES256 | Encryption at rest |
| `aws_s3_bucket_public_access_block` | all block | No public state |
| `aws_s3_bucket_ownership_controls` | BucketOwnerEnforced | Disable ACLs |
| `aws_dynamodb_table` | `agentic-terraform-locks` | State locking (`LockID` hash key) |

### Cognito

| Resource | Notes |
|---|---|
| `aws_cognito_user_pool` | Email as username; password policy; no MFA required initially |
| `aws_cognito_user_pool_client` | App client; auth flows `USER_PASSWORD_AUTH`, `REFRESH_TOKEN_AUTH`; no client secret (public SPA later) |
| `aws_cognito_user_group` (optional) | `admins` group for future RBAC |

### DynamoDB (app data — no RAG)

| Table | Keys | Notes |
|---|---|---|
| `{prefix}-runs` | `pk` (HASH), `sk` (RANGE) | Run metadata / status |
| `{prefix}-checkpoints` | `pk` (HASH), `sk` (RANGE) | LangGraph-style checkpoint docs (Dynamo-backed) |
| `{prefix}-ws-connections` | `connectionId` (HASH) | Active WebSocket connections; TTL attribute `ttl` |
| `{prefix}-users` | `userId` (HASH) | Cognito `sub` → profile/settings |

All tables: PAY_PER_REQUEST, SSE enabled, point-in-time recovery enabled, deletion protection off in `dev`.

### S3 (artifacts only — not hosting)

| Resource | Purpose |
|---|---|
| `aws_s3_bucket` `{prefix}-artifacts` | Lambda deployment zips + opaque run artifacts |
| Versioning + SSE + public access block + ownership controls | Same hardening as state bucket |
| **No** `aws_s3_bucket_website_configuration` | Hosting deferred |

### IAM / Bedrock

| Resource | Purpose |
|---|---|
| Lambda execution roles (per function or shared REST/WS) | `AWSLambdaBasicExecutionRole` + table/bucket/API policies |
| Bedrock invoke policy | `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream` on foundation model ARN |
| Model ID | `openai.gpt-oss-120b-1:0` |
| Model ARN | `arn:aws-us-gov:bedrock:us-gov-west-1::foundation-model/openai.gpt-oss-120b-1:0` |

**Manual prerequisite (not Terraform):** Enable model access in GovCloud Bedrock console after EULA acceptance on the linked commercial account (AWS requirement).

### Lambdas

| Function | Trigger | Role permissions |
|---|---|---|
| `rest-api` | HTTP API routes `ANY /{proxy+}`, `ANY /` | DynamoDB R/W, S3 R/W artifacts, Bedrock invoke |
| `ws-authorizer` | WebSocket `$connect` authorizer | Cognito user pool read / JWT validate (JWKS via public HTTPS) |
| `ws-connect` | `$connect` | DynamoDB `ws-connections` PutItem |
| `ws-default` | `$default` | DynamoDB R/W, Bedrock invoke, manage connections (API GW Management API) |
| `ws-disconnect` | `$disconnect` | DynamoDB `ws-connections` DeleteItem |

Runtime: `nodejs20.x`, timeout 29s (HTTP API max) for REST; WebSocket default up to 5 minutes for agent turns (configurable, default 60s in `dev`). Memory: 512 MB REST / 1024 MB WS default.

### API Gateway HTTP API

| Resource | Notes |
|---|---|
| `aws_apigatewayv2_api` (HTTP) | Protocol `HTTP` |
| JWT authorizer | Issuer = Cognito user pool; audience = app client id |
| Routes | `ANY /`, `ANY /{proxy+}` → rest Lambda |
| Stage `$default` | Auto-deploy |
| Access logs | CloudWatch log group |

### API Gateway WebSocket API

| Resource | Notes |
|---|---|
| `aws_apigatewayv2_api` (WEBSOCKET) | Route selection `$request.body.action` |
| REQUEST authorizer | Lambda `ws-authorizer` on `$connect` (identity source `route.request.header.Authorization` or query `token`) |
| Routes | `$connect`, `$disconnect`, `$default` |
| Stage `dev` | Auto-deploy |
| CloudWatch logs | Execution + access |

### Observability (minimal)

| Resource | Notes |
|---|---|
| CloudWatch log groups | `/aws/lambda/{fn}`, API access logs; retention 30 days |
| Tags | `Project=agentic`, `Env=dev`, `ManagedBy=terraform` |

### Explicitly out of scope (do not create)

- CloudFront, Amplify, S3 website, custom domains, ACM for hosting
- RDS, Aurora, ElastiCache, OpenSearch
- Bedrock Knowledge Bases, Agents, Guardrails (unless added later)
- VPC, subnets, NAT, security groups, VPC endpoints
- WAF (can add later)
- Multi-env / Terragrunt

---

## Outputs (dev stack)

- `cognito_user_pool_id`
- `cognito_client_id`
- `cognito_issuer_url`
- `http_api_endpoint`
- `websocket_api_endpoint`
- `artifacts_bucket_name`
- `dynamodb_table_names` (map)
- `bedrock_model_id`
- `aws_region`

---

## Apply Order

Use the single script (compares remote state → applies only the diff):

```bash
export AWS_PROFILE=govcloud AWS_REGION=us-gov-west-1
./infra/scripts/deploy.sh          # plan + apply changes
./infra/scripts/deploy.sh --plan   # diff only
./infra/scripts/deploy.sh --yes    # non-interactive
```

1. Ensure AWS credentials target a GovCloud account with Bedrock entitlement path ready.
2. Run `./infra/scripts/deploy.sh` — creates/updates bootstrap state backend, then envs/dev.
3. Manually enable Bedrock model access for `openai.gpt-oss-120b-1:0` if not already entitled.
4. Smoke-test: `curl "$(terraform -chdir=infra/envs/dev output -raw http_api_endpoint)/health"`.

---

## App Code Follow-ups (not Terraform)

- Replace PostgresSaver with DynamoDB checkpoint adapter.
- Point LLM client at Bedrock Runtime (`openai.gpt-oss-120b-1:0`) instead of Copilot/OpenAI.
- Wire Cognito JWT validation on the Fastify→Lambda adapter path.
- Hosting (S3+CloudFront or similar) is a later Terraform module, not this stack.

---

## Implementation Tasks

### Task 1: Bootstrap remote state

**Files:**
- Create: `infra/bootstrap/versions.tf`
- Create: `infra/bootstrap/variables.tf`
- Create: `infra/bootstrap/main.tf`
- Create: `infra/bootstrap/outputs.tf`
- Create: `infra/bootstrap/.gitignore`

- [x] **Step 1:** Create bootstrap Terraform for state S3 + lock DynamoDB
- [x] **Step 2:** Document apply → copy backend values into `envs/dev`

### Task 2: Shared modules + Lambda stubs

**Files:**
- Create: `infra/modules/**`
- Create: `infra/lambda/**/index.mjs`

- [x] **Step 1:** Modules for cognito, dynamodb, artifacts_s3, lambda_fn, api_http, api_websocket
- [x] **Step 2:** Stub Lambda handlers (health, connect, default, disconnect, authorizer)

### Task 3: Dev environment root

**Files:**
- Create: `infra/envs/dev/*`

- [x] **Step 1:** Compose modules, IAM Bedrock policy, variables, outputs
- [x] **Step 2:** `terraform.tfvars.example` + README apply instructions

### Task 4: Validation

- [x] **Step 1:** `terraform fmt -recursive`
- [x] **Step 2:** `terraform -chdir=infra/bootstrap init -backend=false && validate`
- [x] **Step 3:** `terraform -chdir=infra/envs/dev init -backend=false && validate`

---

## Self-Review

1. **Spec coverage:** Cognito, HTTP+WS API, Lambdas, DynamoDB, artifacts S3, Bedrock IAM, remote state, no hosting, no RAG, GovCloud west — all covered.
2. **Placeholders:** Backend bucket/table names come from bootstrap outputs (intentional). Model access remains a documented manual AWS step.
3. **Consistency:** Model ID `openai.gpt-oss-120b-1:0`, region `us-gov-west-1`, partition `aws-us-gov` used throughout.
