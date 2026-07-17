#!/usr/bin/env bash
# Single deploy entrypoint for GovCloud infra (us-gov-west-1).
#
# Compares Terraform desired config to the remote statefile, prints the diff,
# and applies ONLY what changed. Re-runs are idempotent (no-op when in sync).
#
# Usage:
#   export AWS_PROFILE=govcloud    # optional named profile
#   export AWS_REGION=us-gov-west-1
#   ./infra/scripts/deploy.sh              # plan → confirm → apply changes
#   ./infra/scripts/deploy.sh --yes        # plan → apply with no prompt
#   ./infra/scripts/deploy.sh --plan       # plan only (no apply)
#   ./infra/scripts/deploy.sh --destroy    # destroy envs/dev (keeps state backend)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INFRA="$ROOT/infra"
BOOTSTRAP="$INFRA/bootstrap"
DEV="$INFRA/envs/dev"
REGION="${AWS_REGION:-us-gov-west-1}"
MODE="deploy" # deploy | plan | destroy
YES=0

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
bold() { printf '\033[1m%s\033[0m\n' "$*"; }

aws_cli() {
  if [[ -n "${AWS_PROFILE:-}" ]]; then
    aws --profile "$AWS_PROFILE" "$@"
  else
    aws "$@"
  fi
}

tf_vars=()
append_tf_vars() {
  tf_vars=(-var "aws_region=${REGION}")
  if [[ -n "${AWS_PROFILE:-}" ]]; then
    tf_vars+=(-var "aws_profile=${AWS_PROFILE}")
  fi
}

usage() {
  sed -n '2,16p' "$0"
}

for arg in "$@"; do
  case "$arg" in
    --yes|-y|--auto-approve) YES=1 ;;
    --plan|--plan-only) MODE="plan" ;;
    --destroy) MODE="destroy" ;;
    -h|--help) usage; exit 0 ;;
    *)
      red "Unknown arg: $arg"
      usage
      exit 2
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Preflight (inlined so there is exactly one script to run)
# ---------------------------------------------------------------------------
preflight() {
  local fail=0
  bold "==> Preflight"

  if ! command -v terraform >/dev/null 2>&1; then
    red "FAIL: terraform not found. Install: brew install hashicorp/tap/terraform"
    fail=1
  else
    green "OK: terraform ($(terraform version | head -1))"
  fi

  if ! command -v aws >/dev/null 2>&1; then
    red "FAIL: aws CLI not found. Install: brew install awscli"
    fail=1
  else
    green "OK: aws ($(aws --version 2>&1))"
  fi

  if command -v terraform >/dev/null 2>&1; then
    local major_minor
    major_minor="$(terraform version -json 2>/dev/null | python3 -c 'import json,sys; v=json.load(sys.stdin)["terraform_version"].split("."); print(f"{v[0]}.{v[1]}")' 2>/dev/null || echo "0.0")"
    if [[ "$(printf '%s\n' "1.5" "$major_minor" | sort -V | head -1)" != "1.5" ]]; then
      red "FAIL: Terraform $major_minor < 1.5"
      fail=1
    fi
  fi

  if command -v aws >/dev/null 2>&1; then
    local out
    if ! out="$(aws_cli sts get-caller-identity --region "$REGION" 2>&1)"; then
      red "FAIL: cannot authenticate to AWS GovCloud ($REGION)"
      echo "$out" | sed 's/^/    /'
      yellow "Hint:"
      yellow "  aws configure --profile govcloud"
      yellow "  export AWS_PROFILE=govcloud AWS_REGION=us-gov-west-1"
      fail=1
    else
      green "OK: authenticated"
      echo "$out" | sed 's/^/    /'
    fi
  fi

  for p in \
    "$BOOTSTRAP/main.tf" \
    "$DEV/main.tf" \
    "$INFRA/lambda/rest/index.mjs"
  do
    [[ -f "$p" ]] || { red "FAIL: missing ${p#"$ROOT"/}"; fail=1; }
  done

  if [[ "$fail" -ne 0 ]]; then
    red "Preflight FAILED"
    exit 1
  fi
  green "Preflight PASSED"
  echo
}

# ---------------------------------------------------------------------------
# Plan → apply only when there is a diff (terraform -detailed-exitcode)
# exit 0 = no changes, 1 = error, 2 = changes present
# ---------------------------------------------------------------------------
plan_and_maybe_apply() {
  local dir="$1"
  local label="$2"
  shift 2
  local extra_vars=("$@")
  local planfile="$dir/.terraform-deploy.tfplan"
  local rc=0

  bold "==> $label — comparing desired config to current state"
  cd "$dir"

  set +e
  terraform plan -input=false -detailed-exitcode -out="$planfile" "${extra_vars[@]}"
  rc=$?
  set -e

  if [[ $rc -eq 1 ]]; then
    red "FAIL: terraform plan error in $label"
    rm -f "$planfile"
    exit 1
  fi

  if [[ $rc -eq 0 ]]; then
    green "OK: $label already up to date — nothing to deploy"
    rm -f "$planfile"
    return 0
  fi

  # rc == 2 → changes
  yellow "Changes detected for $label (see plan above)."

  if [[ "$MODE" == "plan" ]]; then
    yellow "Plan-only mode — not applying $label."
    rm -f "$planfile"
    return 0
  fi

  if [[ "$YES" -ne 1 ]]; then
    echo
    read -r -p "Apply these changes to $label? [y/N] " ans
    case "$ans" in
      y|Y|yes|YES) ;;
      *)
        yellow "Skipped apply for $label."
        rm -f "$planfile"
        return 0
        ;;
    esac
  fi

  bold "==> Applying $label (only planned changes)"
  terraform apply -input=false "$planfile"
  rm -f "$planfile"
  green "OK: $label applied"
  echo
}

ensure_tfvars() {
  if [[ ! -f "$DEV/terraform.tfvars" ]]; then
    echo "==> Creating terraform.tfvars from example"
    cp "$DEV/terraform.tfvars.example" "$DEV/terraform.tfvars"
    if [[ -n "${AWS_PROFILE:-}" ]] && grep -q '^# aws_profile' "$DEV/terraform.tfvars"; then
      # portable in-place edit
      python3 - "$DEV/terraform.tfvars" "$AWS_PROFILE" <<'PY'
import sys
path, profile = sys.argv[1], sys.argv[2]
text = open(path).read()
text = text.replace("# aws_profile = \"govcloud\"", f'aws_profile = "{profile}"')
open(path, "w").write(text)
PY
    fi
  fi
}

write_backend_hcl() {
  local bucket lock_table boot_region
  bucket="$(terraform -chdir="$BOOTSTRAP" output -raw state_bucket_name)"
  lock_table="$(terraform -chdir="$BOOTSTRAP" output -raw lock_table_name)"
  boot_region="$(terraform -chdir="$BOOTSTRAP" output -raw aws_region)"

  cat > "$DEV/backend.hcl" <<EOF
bucket         = "${bucket}"
region         = "${boot_region}"
dynamodb_table = "${lock_table}"
encrypt        = true
EOF
  echo "==> Wrote ${DEV#"$ROOT"/}/backend.hcl"
  sed 's/^/    /' "$DEV/backend.hcl"
  echo
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
preflight
append_tf_vars
mkdir -p "$INFRA/modules/lambda_fn/builds"
ensure_tfvars

# --- Bootstrap (local state) ---
bold "==> Bootstrap remote state backend"
cd "$BOOTSTRAP"
terraform init -input=false >/dev/null
plan_and_maybe_apply "$BOOTSTRAP" "bootstrap" "${tf_vars[@]}"

# Need outputs even when bootstrap was already up to date
if ! terraform -chdir="$BOOTSTRAP" output -raw state_bucket_name >/dev/null 2>&1; then
  if [[ "$MODE" == "plan" ]]; then
    yellow "Bootstrap not applied yet — skipping envs/dev plan (no remote state)."
    yellow "Run ./infra/scripts/deploy.sh to create the state backend, then re-run --plan."
    exit 0
  fi
  red "FAIL: bootstrap has no outputs yet — re-run deploy and approve the bootstrap apply."
  exit 1
fi
write_backend_hcl

# --- Dev stack (remote state) ---
bold "==> Dev application stack"
cd "$DEV"
terraform init -input=false -reconfigure -backend-config=backend.hcl >/dev/null

if [[ "$MODE" == "destroy" ]]; then
  bold "==> Destroying envs/dev (state backend kept)"
  if [[ "$YES" -eq 1 ]]; then
    terraform destroy -input=false -auto-approve
  else
    terraform destroy -input=false
  fi
  green "Destroy complete."
  exit 0
fi

plan_and_maybe_apply "$DEV" "envs/dev"

if [[ "$MODE" == "plan" ]]; then
  yellow "Done (plan only). Run ./infra/scripts/deploy.sh to apply any diffs."
  exit 0
fi

bold "==> Current outputs"
terraform output
echo
green "Deploy finished. Remote state is the source of truth for the next run."
echo "Smoke test:"
echo "  curl \"\$(terraform -chdir=$DEV output -raw http_api_endpoint)/health\""
echo
yellow "If Bedrock invoke fails, enable openai.gpt-oss-120b-1:0 in the GovCloud Bedrock console."
