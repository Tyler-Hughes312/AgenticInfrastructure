# AWS GovCloud Terraform — one deploy script

Region: **`us-gov-west-1`**. Plan: [`docs/superpowers/plans/2026-07-17-govcloud-aws-terraform.md`](../docs/superpowers/plans/2026-07-17-govcloud-aws-terraform.md)

## Deploy (only script you need)

```bash
# One-time credentials
aws configure --profile govcloud
# region: us-gov-west-1

export AWS_PROFILE=govcloud
export AWS_REGION=us-gov-west-1

# Compare remote state → show diff → apply only what changed
./infra/scripts/deploy.sh

# Non-interactive
./infra/scripts/deploy.sh --yes

# Diff only (no apply)
./infra/scripts/deploy.sh --plan

# Tear down app stack (keeps state bucket/lock)
./infra/scripts/deploy.sh --destroy
```

Or: `npm run infra:deploy`

### How it works

1. Preflight (terraform, aws CLI, GovCloud auth)
2. **Bootstrap** — `terraform plan -detailed-exitcode` against local bootstrap state; apply only if the state bucket/lock table need changes
3. Writes `envs/dev/backend.hcl` from bootstrap outputs (no hand-editing)
4. **Dev stack** — `terraform plan -detailed-exitcode -out=…` against the **remote** statefile; apply **only that plan** when there is a diff
5. If already in sync → prints “nothing to deploy” and exits 0

Re-running the script is safe: Terraform compares desired config to the stored state and deploys only creates/updates/destroys that are required.

## Prerequisites

| Tool | Install |
|---|---|
| Terraform >= 1.5 | `brew install hashicorp/tap/terraform` |
| AWS CLI v2 | `brew install awscli` |
| GovCloud keys | `aws configure --profile govcloud` |
| Bedrock model (manual) | Enable `openai.gpt-oss-120b-1:0` in console |

## Frontend ↔ AWS wiring

After `./infra/scripts/deploy.sh`:

```bash
npm run infra:sync-web-env   # writes packages/web/.env.local
npm run dev:web              # http://127.0.0.1:5173/login
```

| Env | Purpose |
|---|---|
| `NEXT_PUBLIC_AUTH_MODE=cognito` | Require Cognito login |
| `NEXT_PUBLIC_API_URL` | HTTP API Gateway endpoint |
| `NEXT_PUBLIC_WS_URL` | WebSocket API stage URL (`wss://…/dev`) |
| `NEXT_PUBLIC_COGNITO_*` | User pool + SPA client |

The web client sends Cognito **ID tokens** as `Authorization: Bearer` on HTTP and `?token=` on WebSocket. Local Fastify mode (`AUTH_MODE=local`) is unchanged.

## Hardening included

- S3 TLS-only bucket policies (state + artifacts)
- DynamoDB SSE + PITR; least-privilege IAM (connect/disconnect vs app Lambdas)
- API access log resource policies + stage `depends_on`
- Cognito without Hosted UI callback attrs (no empty-list apply failures)
- Lambda `arm64` / Node 20; WS management URL derived from API endpoint (GovCloud-safe)
- No VPC, hosting, RAG, or account-level API GW execution logging role
