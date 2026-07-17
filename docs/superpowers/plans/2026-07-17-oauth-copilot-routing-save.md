# Copilot OAuth, Intent Routing & Save Infrastructure Plan

> **For agentic workers:** Use executing-plans or implement task-by-task. Steps use checkbox syntax.

**Goal:** Copilot-only runnable app (OAuth refresh), correct graph_design vs task_run routing, and reliable save infrastructure.

**Architecture:** Persist OAuth token from device login for session refresh; flip defaults to `copilot:*`; fix classifier downgrade bug + golden tests; always save live canvas config to templates with ON DELETE SET NULL.

**Tech Stack:** Existing Fastify/LangChain server, React web, Postgres app tables, Vitest.

## Global Constraints

- No OpenAI key required for core chat/runs
- Keep OpenAI code paths optional
- Git push/PR still needs separate `GITHUB_TOKEN`
- Prefer heuristic golden tests over live LLM for routing

---

### Task 1: OAuth persist + refresh

**Files:** `auth/copilot.ts`, `auth/copilot-token.ts`, `config.ts`, `.env.example`, `.gitignore`

- [ ] Persist `GITHUB_COPILOT_OAUTH_TOKEN` from device flow; warm/401 refresh OAuth → PAT
- [ ] Default `MODEL_PRIMARY`/`FALLBACK` to `copilot:gpt-4o` / `copilot:gpt-4.1`
- [ ] Copilot-first messages in `llm-auth.ts` / `models-llm.ts`; doctor Copilot-sufficient
- [ ] README prerequisites Copilot + `copilot-login`

### Task 2: Intent routing

**Files:** `message-classifier.ts`, `pipeline-gate.ts`, tests

- [ ] Fix LLM `graph_design` → `q_and_a` downgrade
- [ ] Golden tests for team-only vs product build vs edit

### Task 3: Save infrastructure

**Files:** `SaveInfrastructureModal.tsx`, `graph-templates.ts`, `app-db.ts`/`schema.ts`

- [ ] Always POST live `config`; prefer body.config on server
- [ ] Persist session graph before save when sessionId set
- [ ] `ON DELETE SET NULL` for `source_session_id`
- [ ] Round-trip test if feasible

### Task 4: Verify

- [ ] Run server unit tests for classifier/pipeline-gate/copilot helpers
- [ ] Commit when user asks
