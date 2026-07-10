# Agentic Platform

Self-hosted multi-agent coding platform (LangGraph.js + Postgres + React). **All TypeScript.**

## Frontend

The UI is based on **[AgentLens](https://github.com/sanjayanasuri/AgentLens)** (MIT) — a LangGraph debugging cockpit with React Flow graph visualization, live WebSocket streaming, state inspector, and replay controls. See [`packages/web/ATTRIBUTION.md`](packages/web/ATTRIBUTION.md).

We added a **Runs** page (`/runs`) with optional Langfuse trace links and GitHub PR outbound links.

## Prerequisites

- Node 18+
- **Local Postgres** for graph checkpoints (`createdb agent_platform`)
- **OpenAI API key** for all agent LLM calls (`OPENAI_API_KEY` in repo-root `.env`)
- GitHub PAT with `repo` scope (when pushing to GitHub)
- `DEFAULT_REPO_URL` in server `.env` (or create a project via API)

**Optional:** Langfuse tracing — set `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` (cloud or self-hosted). The app runs fine without them.

## Quick start

```bash
cp packages/server/.env.example packages/server/.env
cp packages/web/.env.example packages/web/.env.local
# edit packages/server/.env — see Database section below

npm install

# Terminal 1 — API (port 8000)
npm run dev:server

# Terminal 2 — AgentLens UI (port 5173)
npm run dev:web
```

Open http://localhost:5173 — home page to start a run, `/runs` for the monitoring table.

## Database

Use a **local Postgres** instance (Homebrew, Postgres.app, etc.). No Docker required.

```bash
createdb agent_platform
```

In `packages/server/.env`, set `DATABASE_URL` to your local user (on macOS this is usually your login name, not `postgres`):

```bash
DATABASE_URL=postgresql://YOUR_MAC_USERNAME@localhost:5432/agent_platform
MEMORY_STORE=inmemory
```

`MEMORY_STORE=inmemory` keeps long-term agent memory in-process — simplest for local dev. For Postgres-backed semantic memory, install the `vector` extension and set `MEMORY_STORE=postgres`:

```bash
psql agent_platform -c 'CREATE EXTENSION IF NOT EXISTS vector;'
```

## Langfuse (optional)

Tracing is off unless you provide keys. Either:

- **Langfuse Cloud:** set `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_BASE_URL` (or `LANGFUSE_HOST`) in `packages/server/.env` or the repo-root `.env`
- **Skip it:** leave keys blank — runs complete normally; trace links on `/runs` stay empty

You can also paste keys in the in-app **Settings** panel at runtime.

See [PLAN.md](PLAN.md) for phase-by-phase development.
