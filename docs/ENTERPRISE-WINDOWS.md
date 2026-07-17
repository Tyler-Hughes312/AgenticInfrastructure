# Enterprise Windows setup

Run this app on locked-down **Windows** PCs with **local PostgreSQL**. Docker is not used and not required.

**Copilot-first auth:** follow [COPILOT-SETUP.md](./COPILOT-SETUP.md) (`npm run setup:copilot` / `--login`).

## What IT must allow

### Software (one-time)

| Item | Notes |
|------|--------|
| Node.js 18+ LTS | [nodejs.org](https://nodejs.org) — user-scoped install is fine |
| PostgreSQL 14+ | Official Windows installer — service on port **5432** |
| Git | For cloning this repo and agent git tools |

### Network allowlist (outbound HTTPS)

| Destination | Why |
|-------------|-----|
| `api.githubcopilot.com` | LLM calls (Copilot OAuth / session token) |
| `api.github.com` | Copilot token exchange, repo create / push / PR |
| `github.com` | Device login + git remotes |
| `registry.npmjs.org` | `npm install` (or your internal npm mirror) |
| `us.cloud.langfuse.com` (optional) | Tracing only |
| `api.openai.com` (optional) | Only if using `OPENAI_API_KEY` |

Also allow your **corporate HTTP/HTTPS proxy** if all traffic must go through it.

### Local ports (inbound localhost)

| Port | Service |
|------|---------|
| `5432` | PostgreSQL |
| `8000` | API (`@agentic/server`) |
| `5173` | Web UI (`@agentic/web`) |

No admin-privileged ports (&lt; 1024) are required.

## 1. Install PostgreSQL (Windows)

1. Download the [PostgreSQL Windows installer](https://www.postgresql.org/download/windows/).
2. Install with default port **5432**.
3. Remember the password you set for the `postgres` superuser (Windows installs usually use password auth).
4. Ensure **pgAdmin** / **Stack Builder** optional components can be skipped.
5. Confirm the service is running: Services → `postgresql-x64-…` → Running.

Create the database (PowerShell or SQL Shell / `psql`):

```powershell
& "C:\Program Files\PostgreSQL\15\bin\psql.exe" -U postgres -c "CREATE DATABASE agent_platform;"
```

Or from the repo after Node deps are installed:

```powershell
npm run setup:db
```

## 2. Configure environment

```powershell
copy packages\server\.env.example packages\server\.env
copy packages\web\.env.example packages\web\.env.local
```

Edit `packages\server\.env`:

```env
# Windows Postgres usually uses the postgres user + password from the installer
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/agent_platform
MEMORY_STORE=inmemory

# Prefer localhost binding on corp machines
ENTERPRISE_MODE=true
API_HOST=127.0.0.1
API_PORT=8000

OPENAI_API_KEY=           # optional
# Prefer: npm run copilot-login -w @agentic/server
GITHUB_COPILOT_OAUTH_TOKEN=
GITHUB_COPILOT_TOKEN=
GITHUB_TOKEN=ghp_...   # optional — push/PR only
MODEL_PRIMARY=copilot:gpt-4o
MODEL_FALLBACK=copilot:gpt-4.1

# If the repo folder is locked/synced, put workspaces under LocalAppData:
# WORKSPACE_ROOT=C:\Users\YOU\AppData\Local\agentic-platform\workspaces
```

Edit `packages\web\.env.local` if needed (defaults are fine for local):

```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
NEXT_PUBLIC_WS_URL=ws://127.0.0.1:8000
```

## 3. Corporate proxy / TLS inspection

If browsers work only through a proxy:

```powershell
$env:HTTPS_PROXY="http://proxy.company.com:8080"
$env:HTTP_PROXY="http://proxy.company.com:8080"
$env:NO_PROXY="localhost,127.0.0.1"
# Node 22+: honor proxy env for fetch
$env:NODE_USE_ENV_PROXY="1"
```

If IT does HTTPS interception, install the corporate root CA and point Node at it:

```powershell
$env:NODE_EXTRA_CA_CERTS="C:\path\to\corp-root-ca.pem"
```

You can also put these in `packages\server\.env` (see `.env.example`).

## 4. Install and verify

```powershell
npm install
npm run doctor
npm run setup:db
npm run dev
```

- API: http://127.0.0.1:8000/health  
- UI: http://127.0.0.1:5173  

`npm run doctor` checks Node version, Postgres connectivity, free ports, and whether API keys are set. Fix any FAIL lines before starting.

## 5. Common blockers

| Symptom | Fix |
|---------|-----|
| `ECONNREFUSED` on 5432 | Start PostgreSQL Windows service; check `DATABASE_URL` password |
| `password authentication failed` | Reset/check `postgres` user password in `DATABASE_URL` |
| `EADDRINUSE` 8000/5173 | Stop other Node processes or change `API_PORT` / Next port |
| `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | Set `NODE_EXTRA_CA_CERTS` to corp CA PEM |
| `npm install` hangs / ETIMEDOUT | Set `HTTPS_PROXY` or use internal npm registry |
| OpenAI / GitHub timeouts | Ask IT to allowlist domains above |
| Antivirus locks `.workspaces` | Set `WORKSPACE_ROOT` under `%LOCALAPPDATA%` and exclude that folder |
| Docker mentioned in old notes | Ignore — this app must **not** use Docker |

## 6. What not to do

- Do **not** install Docker Desktop or point `DATABASE_URL` at a container (`:5433`, `postgres:postgres@…`).
- Do **not** bind the API to `0.0.0.0` on a managed laptop unless IT requires LAN access — use `ENTERPRISE_MODE=true` / `API_HOST=127.0.0.1`.
