# Agentic Platform

Self-hosted multi-agent coding platform (LangGraph.js + Postgres + React). **All TypeScript.**

## Frontend

The UI is based on **[AgentLens](https://github.com/sanjayanasuri/AgentLens)** (MIT) — a LangGraph debugging cockpit with React Flow graph visualization, live WebSocket streaming, state inspector, and replay controls. See [`packages/web/ATTRIBUTION.md`](packages/web/ATTRIBUTION.md).

We added a **Runs** page (`/runs`) with Langfuse trace + GitHub PR outbound links per the original plan.

## Prerequisites

- Node 18+
- Postgres (Docker **or** Homebrew) for graph checkpoints
- GitHub Copilot subscription + `GITHUB_COPILOT_TOKEN` (or `npm run copilot-login -w @agentic/server`)
- OpenAI API key (fallback + embeddings)
- GitHub PAT with `repo` scope
- `DEFAULT_REPO_URL` in server `.env` (or create a project via API)

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

Port **5432** on macOS is often **local Homebrew Postgres** (user = your macOS username), not Docker’s `postgres` user.

### Option A — Local Postgres (fastest if Docker is off)

```bash
createdb agent_platform
```

In `packages/server/.env`:

```bash
DATABASE_URL=postgresql://YOUR_MAC_USERNAME@localhost:5432/agent_platform
MEMORY_STORE=inmemory
```

### Option B — Docker pgvector (production-like memory)

Start **Docker Desktop**, then:

```bash
docker compose up -d
```

In `packages/server/.env`:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/agent_platform
MEMORY_STORE=postgres
```

Langfuse: `docker compose -f packages/server/docker-compose.langfuse.yml up -d` → http://localhost:3000

See [PLAN.md](PLAN.md) for phase-by-phase development.
