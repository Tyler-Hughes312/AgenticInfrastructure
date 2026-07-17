# Copilot OAuth, intent routing, and save infrastructure

**Date:** 2026-07-17  
**Status:** Approved for planning  
**Approach:** Copilot-first OAuth refresh + heuristic/LLM decision table + live-canvas save (Approach 1 for each area)

## Goals

1. **Copilot-only runnable** — Full local app runs with only GitHub Copilot OAuth from `npm run copilot-login`. No `OPENAI_API_KEY` required. Session tokens auto-refresh from a persisted OAuth GitHub token.
2. **Correct intent routing** — Reliably distinguish canvas/team setup (`graph_design` / `graph_edit`) from product builds that execute subagents (`task_run`).
3. **Save infrastructure works** — Explicit save snapshots the live canvas into `saved_graph_templates` and round-trips via list/load/apply.

## Non-goals

- Removing OpenAI provider code (keep optional if a key is present later)
- Two-step UX forcing the user to pick “Edit graph” vs “Run agents”
- Making git push/PR work without a separate `GITHUB_TOKEN` with `repo` scope
- Redesigning the agent pipeline topology itself (only when to design vs when to execute)

---

## Part A — OAuth Copilot auth

### Tokens

| Token | Lifetime | Storage | Role |
|-------|----------|---------|------|
| OAuth GitHub token (`gho_…` from device flow) | Long-lived until revoked | `GITHUB_COPILOT_OAUTH_TOKEN` in `packages/server/.env`; optional `.copilot_oauth` (gitignored) | Refresh source for session tokens |
| Copilot session token (from `copilot_internal/v2/token`) | Short (~1h, embeds `exp=`) | `GITHUB_COPILOT_TOKEN` / `.copilot_token` | LLM calls to `api.githubcopilot.com` |
| `GITHUB_TOKEN` (PAT) | Long-lived | Existing env | Optional alternate refresh source; required for git push/PR |

### `copilot-login` flow

1. Device code OAuth → GitHub OAuth access token.
2. Persist OAuth token as `GITHUB_COPILOT_OAUTH_TOKEN`.
3. Exchange via `https://api.github.com/copilot_internal/v2/token` → session token.
4. Persist session as `GITHUB_COPILOT_TOKEN` and `.copilot_token`.

### Warm / refresh

On startup (`warmCopilotTokenFromEnv`): use non-expired session if present; else exchange via `GITHUB_COPILOT_OAUTH_TOKEN` then `GITHUB_TOKEN`; else clear error pointing at `copilot-login`.

On LLM **401** (once): invalidate session → re-exchange → retry once → else `COPILOT_AUTH_HELP`.

### Model defaults

- `MODEL_PRIMARY=copilot:gpt-4o`
- `MODEL_FALLBACK=copilot:gpt-4.1`
- OpenAI models only when `OPENAI_API_KEY` is set
- `MEMORY_STORE=inmemory` default (no embeddings required)

### Config / doctor / docs

- Add `GITHUB_COPILOT_OAUTH_TOKEN`; Copilot defaults; OpenAI optional
- Doctor passes with Copilot credentials; outbound probe GitHub/Copilot when Copilot-only
- README + enterprise docs: Copilot + `copilot-login`; allowlist `api.githubcopilot.com`
- Error copy points at Copilot / `copilot-login`

---

## Part B — Intent routing (graph edit vs build)

### Priority (first match wins)

1. Regex structural edit → `graph_edit`
2. Team structure **and** product deliverable → `task_run` (design graph during run if blank)
3. Team structure only → `graph_design` (canvas only; no pipeline)
4. Meta / greeting → `q_and_a`
5. LLM classify → apply **guards**: never downgrade a heuristic `graph_design` / `task_run` to `q_and_a`; if LLM says `graph_design` and structure heuristics match (even weakly), keep `graph_design`

### Known bug to fix

In `message-classifier.ts`, when the LLM returns `graph_design` but `isTeamStructureOnly` is false, the code currently returns `q_and_a`. That incorrectly suppresses team-setup requests. Remove/loosen that gate so structure-shaped messages stay `graph_design` (or become `task_run` when a product deliverable is also present).

### Golden cases (heuristic paths must not need a live LLM)

| Message | Intent |
|---------|--------|
| “make a full software dev team with subagents” | `graph_design` |
| “build a todo app” | `task_run` |
| “build a software team and implement a todo app” | `task_run` |
| “add security agent” | `graph_edit` |
| “What agents do I have?” | `q_and_a` |

### Runtime

`run-service` keeps current handling: `graph_design` applies canvas changes and only falls through to pipeline when `looksLikeProductDeliverable`; `task_run` uses `shouldExecutePipeline`; structural `graph_edit` applies immediately / pending confirmation for NL edits.

---

## Part C — Save infrastructure

1. **Save always snapshots the live canvas** — Client POST always includes `config`. `session_id` is optional source metadata, not the sole source of truth.
2. **Server** — Prefer `body.config` when present; fall back to session graph only if config omitted. Reject empty graphs with clear 400.
3. **Before save (client)** — If `sessionId` exists, await `saveChatSessionGraph(sessionId, config)` so session DB matches the template snapshot.
4. **Load/apply** — Keep apply-to-session + open-as-new-session; after apply, UI must reflect DB (`applyRemoteConfig` / reload).
5. **FK** — `source_session_id` uses `ON DELETE SET NULL` (migrate existing FK) so deleting a chat session does not block or delete saved templates.
6. **Test** — Save → list → get round-trip (unit or route test).

---

## Runtime touchpoints (combined)

| Area | Change |
|------|--------|
| `auth/copilot.ts`, `auth/copilot-token.ts` | Persist OAuth + session; OAuth-first refresh; 401 retry |
| `config.ts`, `.env.example`, `.gitignore` | OAuth env; Copilot model defaults; `.copilot_oauth` |
| `models-llm.ts`, `llm-auth.ts`, `doctor.ts` | Copilot-first readiness / doctor |
| README / enterprise docs | Copilot-only quick start + allowlist |
| `message-classifier.ts`, `pipeline-gate.ts` (+ tests) | Decision table + fix graph_design→q_and_a downgrade |
| `SaveInfrastructureModal.tsx`, `api-client.ts`, `graph-templates.ts` | Always send live `config`; prefer body.config |
| `app-db.ts` / schema | `ON DELETE SET NULL` for template source session |

## Success criteria

1. Only `copilot-login` (no OpenAI key): doctor LLM checks pass; server starts; chat/run can call Copilot; expired session refreshes from OAuth token.
2. Golden intent cases above pass on heuristic paths.
3. Team-only messages update the canvas and do **not** spawn a build pipeline; product builds do run subagents (designing the graph first if blank).
4. Save infrastructure with agents on canvas creates a listable template whose loaded config matches what was on the canvas; deleting the source session leaves the template intact.

## Testing notes

- Unit: Copilot expiry/refresh priority; `selectAuthenticatedModels` Copilot-only; classifier/pipeline-gate golden cases; template save round-trip.
- Manual: `copilot-login` → chat; “make a software dev team” (canvas only) then “build a todo app” (pipeline); Save infrastructure → Load infrastructure.
