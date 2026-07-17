# OAuth Copilot-only runnable platform

**Date:** 2026-07-17  
**Status:** Approved for planning  
**Approach:** Copilot-first defaults + persisted OAuth refresh source (Approach 1)

## Goal

Make the full local app runnable with **only** GitHub Copilot OAuth credentials from `npm run copilot-login`. No `OPENAI_API_KEY` required. Short-lived Copilot session tokens auto-refresh from a persisted OAuth GitHub token until that OAuth grant is revoked.

## Non-goals

- Removing OpenAI provider code (keep optional if a key is present later)
- Changing agent graph / pipeline behavior
- Making git push/PR work without a separate `GITHUB_TOKEN` with `repo` scope

## Auth model

### Tokens

| Token | Lifetime | Storage | Role |
|-------|----------|---------|------|
| OAuth GitHub token (`gho_…` from device flow) | Long-lived until revoked | `GITHUB_COPILOT_OAUTH_TOKEN` in `packages/server/.env`; optional cache file `.copilot_oauth` (gitignored) | Refresh source for session tokens |
| Copilot session token (from `copilot_internal/v2/token`) | Short (~1h, embeds `exp=`) | `GITHUB_COPILOT_TOKEN` / `.copilot_token` | LLM calls to `api.githubcopilot.com` |
| `GITHUB_TOKEN` (PAT) | Long-lived | Existing env | Optional alternate refresh source; required for git push/PR |

### `copilot-login` flow

1. Device code OAuth (`client_id` for Copilot IDE) → GitHub OAuth access token.
2. Persist OAuth token as `GITHUB_COPILOT_OAUTH_TOKEN`.
3. Exchange OAuth token via `https://api.github.com/copilot_internal/v2/token` → session token.
4. Persist session as `GITHUB_COPILOT_TOKEN` and `.copilot_token`.

### Warm / refresh

On server startup (`warmCopilotTokenFromEnv`):

1. If a non-expired session token exists → use it.
2. Else exchange using refresh sources in order: `GITHUB_COPILOT_OAUTH_TOKEN` → `GITHUB_TOKEN` PAT.
3. Write refreshed session to cache / env as today.
4. If none work → log clear error pointing at `npm run copilot-login`.

On LLM **401** (once per failure):

1. Invalidate cached session (`ignoreEnvCopilotToken` / clear in-memory cache).
2. Re-exchange from OAuth/PAT.
3. Retry the model call once.
4. If still failing → surface `COPILOT_AUTH_HELP`.

## Model defaults

- `MODEL_PRIMARY=copilot:gpt-4o`
- `MODEL_FALLBACK=copilot:gpt-4.1`
- OpenAI models are only selected when `OPENAI_API_KEY` is set.
- `MEMORY_STORE=inmemory` remains default so embeddings are not required.

## Config / doctor / docs

1. **`.env.example` / `config.ts`:** Add `GITHUB_COPILOT_OAUTH_TOKEN`; Copilot model defaults; document that OAuth token is written by `copilot-login` (do not hand-edit casually). `OPENAI_API_KEY` optional.
2. **`doctor`:** LLM check passes if any of: valid session token, OAuth refresh token, or PAT that can exchange. OpenAI optional. Outbound probe targets GitHub/Copilot endpoints when Copilot-only.
3. **README + `docs/ENTERPRISE-WINDOWS.md`:** Prerequisites = Copilot subscription + `copilot-login`. Allowlist `api.githubcopilot.com`, `api.github.com`, `github.com` (login + remotes). Drop OpenAI as required.
4. **Error copy** in `llm-auth.ts`, `models-llm.ts`, Settings: point at Copilot / `copilot-login`, not OpenAI-first messaging.

## Runtime touchpoints

| File / area | Change |
|-------------|--------|
| `auth/copilot.ts` | Persist OAuth + session; export exchange helpers as needed |
| `auth/copilot-token.ts` | OAuth-first refresh; warm + 401 path |
| `config.ts` | `GITHUB_COPILOT_OAUTH_TOKEN`; default `MODEL_*` to `copilot:*` |
| `models-llm.ts` / `llm-auth.ts` | Copilot-first readiness messages |
| `db.ts` | Unchanged behavior: no embeddings without OpenAI key |
| `doctor.ts` | Copilot-sufficient env + outbound checks |
| `.gitignore` | Add `.copilot_oauth` if file cache is used |
| README / `.env.example` / enterprise docs | Copilot-only quick start |

## Success criteria

1. With only a successful `copilot-login` (no `OPENAI_API_KEY`), `npm run doctor` passes LLM-related checks.
2. Server starts and reports `copilot=true` (or equivalent via OAuth/cache).
3. A chat/run can call Copilot models.
4. An expired session token refreshes from `GITHUB_COPILOT_OAUTH_TOKEN` without re-running device login.
5. Git push/PR still clearly requires a separate `GITHUB_TOKEN` when used.

## Testing notes

- Unit: expiry detection; refresh source priority; `selectAuthenticatedModels` with Copilot-only creds.
- Manual: `copilot-login` → start server with OpenAI unset → one agent chat message succeeds; optionally expire/clear session and confirm warm/401 refresh.
