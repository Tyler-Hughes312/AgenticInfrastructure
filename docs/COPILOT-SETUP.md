# Copilot setup (Windows + macOS)

> Drop this file into the repo (or open it in Cursor) and follow every step.  
> Fast path: `npm run setup:copilot` → edit `DATABASE_URL` → `npm run setup:db` → `npm run setup:copilot -- --login` → `npm run doctor` → `npm run dev`

## What you need

- Node.js **18+**
- Local **PostgreSQL** on port `5432` (no Docker)
- An active **GitHub Copilot** subscription on your GitHub account
- Network access to: `github.com`, `api.github.com`, `api.githubcopilot.com`, `registry.npmjs.org`

## 1. Clone & install

**PowerShell (Windows):**

```powershell
cd path\to\AgenticInfrastructure
npm install
npm run setup:copilot
```

**macOS / Linux:**

```bash
cd path/to/AgenticInfrastructure
npm install
npm run setup:copilot
```

This creates `packages/server/.env` and `packages/web/.env.local` if missing, and sets `MODEL_PRIMARY=copilot:gpt-4o`.

## 2. Database

**Windows** (Postgres installer user + password) — edit `packages/server/.env`:

```env
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/agent_platform
MEMORY_STORE=inmemory
ENTERPRISE_MODE=true
API_HOST=127.0.0.1
```

```powershell
# Ensure PostgreSQL Windows service is Running, then:
npm run setup:db
```

**macOS** (Homebrew — use your login name):

```env
DATABASE_URL=postgresql://YOUR_MAC_USERNAME@localhost:5432/agent_platform
MEMORY_STORE=inmemory
```

```bash
createdb agent_platform   # if needed
npm run setup:db
```

## 3. Copilot login (required for Copilot-only)

Interactive device login (browser + one-time code):

```powershell
npm run setup:copilot -- --login
```

Same as `npm run copilot-login -w @agentic/server`.

Writes into `packages/server/.env`:

| Variable | Purpose |
|----------|---------|
| `GITHUB_COPILOT_OAUTH_TOKEN` | Long-lived refresh (from device OAuth) |
| `GITHUB_COPILOT_TOKEN` | Short-lived session for `api.githubcopilot.com` |

Also confirm:

```env
MODEL_PRIMARY=copilot:gpt-4o
MODEL_FALLBACK=copilot:gpt-4.1
```

**Important:** A repo-root `.env` **overrides** `packages/server/.env`. After login, check both files. Do not leave `MODEL_PRIMARY=openai:…` unless you have `OPENAI_API_KEY`.

A normal GitHub PAT **cannot** replace this login for chat (many PATs get 403/404 on the Copilot exchange API).

## 4. Optional: git push / PR

```env
GITHUB_TOKEN=ghp_...   # classic PAT with repo scope
```

## 5. Verify

```powershell
npm run doctor
npm test
```

Expect Postgres OK, LLM credentials showing `copilot`, ports free (or already used by `npm run dev`).

## 6. Run

```powershell
npm run dev
```

| URL | What |
|-----|------|
| http://127.0.0.1:8000/health | API health JSON |
| http://127.0.0.1:5173 | UI |

Smoke checks:

1. `make a full software dev team with subagents` → canvas only  
2. `build a small todo app` → agents execute  
3. Graph → **Save infrastructure** → Load works  

## Token refresh

Session tokens expire ~hourly. Server refreshes from `GITHUB_COPILOT_OAUTH_TOKEN` on startup / auth failure.

If auth keeps failing:

```powershell
npm run setup:copilot -- --login
# Ctrl+C the old dev server, then:
npm run dev
```

## Corporate proxy (Windows)

```powershell
$env:HTTPS_PROXY="http://proxy.company.com:8080"
$env:HTTP_PROXY="http://proxy.company.com:8080"
$env:NO_PROXY="localhost,127.0.0.1"
$env:NODE_USE_ENV_PROXY="1"
# $env:NODE_EXTRA_CA_CERTS="C:\path\to\corp-root-ca.pem"
npm run doctor
npm run dev
```

See also [ENTERPRISE-WINDOWS.md](./ENTERPRISE-WINDOWS.md).

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `copilot=false` at startup | Run `--login`; check root `.env` |
| Doctor LLM fail | Complete device login |
| PAT exchange 403/404 | Use device login, not PAT alone |
| Postgres refused | Start service; fix `DATABASE_URL` |
| Port in use | Kill old Node/`npm run dev` |
| OpenAI errors, no key | Set `MODEL_PRIMARY=copilot:gpt-4o` + login |
