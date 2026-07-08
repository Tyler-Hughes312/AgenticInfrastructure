# Agentic Platform Build Plan (Node.js / TypeScript)

Self-hosted multi-agent coding platform — **all JavaScript/TypeScript** monorepo.

## Stack

| Layer | Choice |
|---|---|
| Monorepo | npm workspaces: `packages/server` + `packages/web` |
| API | Fastify + `@fastify/websocket` |
| Orchestration | `@langchain/langgraph` + `@langchain/langgraph-supervisor` |
| Memory | LangGraph `PostgresStore` + custom manage/search memory tools |
| Models | Copilot primary, OpenAI fallback (no Anthropic) |
| Persistence | Postgres + pgvector (`docker-compose.yml`) |
| Observability | Langfuse (self-hosted Docker) |
| Frontend | React 18 + Vite + Tailwind + xyflow + TanStack Table |

## Phases

0. Monorepo bootstrap  
1. Server foundation (Fastify, DB, models)  
2. Sandboxed tools  
3. Supervisor + workers  
4. Long-term memory  
5. Langfuse  
6. REST + WebSocket API  
7–9. Frontend pages  
10. E2E verification  

## Model config

```
MODEL_PRIMARY=copilot:gpt-4o
MODEL_FALLBACK=openai:gpt-4.1
GITHUB_COPILOT_TOKEN=
OPENAI_API_KEY=
```
