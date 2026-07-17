# Enterprise Windows readiness (local Postgres, no Docker)

**Date:** 2026-07-17  
**Status:** Approved  
**OS target:** Windows enterprise PCs  
**DB:** Local PostgreSQL install (no Docker)

## Goals

Make the Agentic platform runnable on locked-down Windows machines where:

- Docker is blocked or unavailable
- Local Postgres can be installed once (IT or self-service installer)
- Corporate proxy / TLS inspection may intercept HTTPS
- Outbound firewall allowlists are required
- Binding to all interfaces may be restricted or undesirable

## Non-goals

- SQLite / zero-install DB fallback
- Windows service packaging / MSI installer
- Offline LLM (still needs OpenAI or Copilot network access)

## Design

### Configuration

- `ENTERPRISE_MODE=true` → API binds to `127.0.0.1` by default (override with `API_HOST`)
- Keep rejecting Docker-style `DATABASE_URL` (port 5433 / `postgres:postgres`)
- Document `HTTPS_PROXY` / `HTTP_PROXY` / `NODE_EXTRA_CA_CERTS` / `NODE_USE_ENV_PROXY=1`
- Workspace path configurable via `WORKSPACE_ROOT` (prefer user-writable folder under `%LOCALAPPDATA%` when repo is locked)

### Tooling

- `npm run doctor` — preflight: Node version, Postgres reachability, ports 8000/5173, required env, optional outbound HTTPS probe
- `npm run setup:db` — create `agent_platform` DB if missing (uses `psql` / connection string)
- Cross-platform `npm run dev` via `concurrently` (Windows-safe; no `&`)

### Runtime

- Startup preflight fails fast with actionable Windows-oriented errors if Postgres is down
- Proxy bootstrap when `HTTPS_PROXY`/`HTTP_PROXY` is set
- Health remains `GET /health`

### Docs

- `docs/ENTERPRISE-WINDOWS.md` — IT allowlist, Postgres install, proxy/CA, ports, troubleshooting
- README link to that guide

## Success criteria

1. Fresh Windows box with Node 18+ and local Postgres can run doctor → setup:db → dev without Docker
2. Doctor surfaces clear failures for missing Postgres, blocked ports, missing API keys
3. With `ENTERPRISE_MODE=true`, API listens on localhost only
