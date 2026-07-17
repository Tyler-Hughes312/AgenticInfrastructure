# Agentic Platform

Self-hosted multi-agent coding platform (LangGraph.js + Postgres + React). **All TypeScript.**

## Frontend

The UI is based on **[AgentLens](https://github.com/sanjayanasuri/AgentLens)** (MIT) — a LangGraph debugging cockpit with React Flow graph visualization, live WebSocket streaming, state inspector, and replay controls. See [`packages/web/ATTRIBUTION.md`](packages/web/ATTRIBUTION.md).

We added a **Runs** page (`/runs`) with optional Langfuse trace links and GitHub PR outbound links.

## Prerequisites

- Node 18+
- **Local Postgres** for graph checkpoints (`createdb agent_platform` / `npm run setup:db`)
- **GitHub Copilot** — run `npm run copilot-login -w @agentic/server` (writes OAuth + session tokens). No OpenAI key required.
- GitHub PAT with `repo` scope (optional — only when pushing to GitHub)
- `DEFAULT_REPO_URL` in server `.env` (or create a project via API)

**Copilot setup (recommended):** see [docs/COPILOT-SETUP.md](docs/COPILOT-SETUP.md) — `npm run setup:minimal` then `npm run setup:copilot -- --login` (tokens auto-write to `.env`).

**Enterprise Windows (locked-down PCs):** see [docs/ENTERPRISE-WINDOWS.md](docs/ENTERPRISE-WINDOWS.md) — local Postgres only, no Docker, proxy/CA, IT allowlist, `npm run doctor`.

**Optional:** OpenAI (`OPENAI_API_KEY`) for `openai:` models / embeddings. Langfuse tracing — set `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY`. The app runs fine without them.

## Quick start

```bash
cp packages/server/.env.example packages/server/.env
cp packages/web/.env.example packages/web/.env.local
# edit packages/server/.env — see Database section below

npm install
npm run copilot-login -w @agentic/server   # device login → Copilot tokens
npm run doctor      # checks Node, Postgres, ports, keys
npm run setup:db   # creates agent_platform if missing

# API + UI (Windows-safe; or use two terminals)
npm run dev
# or:
#   npm run dev:server   # port 8000
#   npm run dev:web      # port 5173
```

Open http://127.0.0.1:5173 — home page to start a run, `/runs` for the monitoring table.

## Database

**Local Postgres only** (Homebrew, Postgres.app, etc.). This project does **not** use Docker for the database or anything else.

```bash
# Homebrew example
brew install postgresql@15
brew services start postgresql@15
createdb agent_platform
```

In `packages/server/.env`, set `DATABASE_URL` to your local user (on macOS this is usually your login name, not `postgres`):

```bash
DATABASE_URL=postgresql://YOUR_MAC_USERNAME@localhost:5432/agent_platform
MEMORY_STORE=inmemory
```

Do not point `DATABASE_URL` at Docker containers (e.g. port `5433` or `postgres:postgres@...`).

`MEMORY_STORE=inmemory` keeps long-term agent memory in-process — simplest for local dev. Graph checkpoints and app tables still use local Postgres. For Postgres-backed semantic memory, install the `vector` extension on your local DB and set `MEMORY_STORE=postgres`:

```bash
psql agent_platform -c 'CREATE EXTENSION IF NOT EXISTS vector;'
```

## Langfuse (optional)

Tracing is off unless you provide keys. Either:

- **Langfuse Cloud:** set `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_BASE_URL` (or `LANGFUSE_HOST`) in `packages/server/.env` or the repo-root `.env`
- **Skip it:** leave keys blank — runs complete normally; trace links on `/runs` stay empty

You can also paste keys in the in-app **Settings** panel at runtime.

See [PLAN.md](PLAN.md) for phase-by-phase development.
