# Copilot setup (Windows + macOS + Linux)

> Fast path (no OpenAI / Langfuse / Docker required):
>
> ```powershell
> npm install
> npm run setup:minimal
> npm run setup:copilot -- --login
> npm run setup:db
> npm run doctor
> npm run test:e2e
> npm run dev
> ```

## Copilot login (device code → `.env` automatic)

```powershell
npm run setup:copilot -- --login
```

What happens:

1. Terminal prints a **URL** + **one-time code** (browser usually opens for you)
2. You sign in to GitHub and enter the code
3. The app exchanges the OAuth grant for a Copilot session token
4. These are **written automatically** into `packages/server/.env` (and repo-root `.env` if it exists):
   - `GITHUB_COPILOT_OAUTH_TOKEN` — refresh
   - `GITHUB_COPILOT_TOKEN` — session
   - `MODEL_PRIMARY=copilot:gpt-4o`
   - `MODEL_FALLBACK=copilot:gpt-4.1`

You should **not** paste tokens by hand. Restart `npm run dev` after login.

## What you need

- Node.js **18+**
- Local **PostgreSQL** on port `5432` (no Docker)
- An active **GitHub Copilot** subscription
- Network: `github.com`, `api.github.com`, `api.githubcopilot.com`, `registry.npmjs.org`

## 1. Clone & install

**PowerShell (Windows):**

```powershell
cd path\to\AgenticInfrastructure
npm install
npm run setup:minimal
```

**macOS / Linux:**

```bash
cd path/to/AgenticInfrastructure
npm install
npm run setup:minimal
```

`setup:minimal` creates env files, clears OpenAI/Langfuse keys, sets Copilot models, and picks a platform-appropriate `DATABASE_URL` placeholder.

## 2. Database

**Windows** — edit `packages/server/.env` password if needed:

```env
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/agent_platform
```

```powershell
npm run setup:db
```

**macOS / Linux:**

```env
DATABASE_URL=postgresql://YOUR_USERNAME@localhost:5432/agent_platform
```

```bash
npm run setup:db
```

## 3. Verify (no secrets for most checks)

```powershell
npm run doctor
npm run test:e2e
```

`test:e2e` covers Windows/macOS/Linux env writing, URL shapes, Copilot model presets, and intent heuristics. Live `/health` checks run only if the API is already up.

## 4. Run

```powershell
npm run dev
```

| URL | What |
|-----|------|
| http://127.0.0.1:8000/health | API |
| http://127.0.0.1:5173 | UI |

## Token refresh

Session tokens expire ~hourly. On startup the server refreshes from `GITHUB_COPILOT_OAUTH_TOKEN`.

If auth fails:

```powershell
npm run setup:copilot -- --login
npm run dev
```

## Corporate proxy (Windows)

```powershell
$env:HTTPS_PROXY="http://proxy.company.com:8080"
$env:HTTP_PROXY="http://proxy.company.com:8080"
$env:NO_PROXY="localhost,127.0.0.1"
$env:NODE_USE_ENV_PROXY="1"
npm run doctor
npm run dev
```

See [ENTERPRISE-WINDOWS.md](./ENTERPRISE-WINDOWS.md).

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `copilot=false` | Run `--login`; check root `.env` override |
| PAT 403/404 | Expected — use device login, not PAT alone |
| Tokens not in `.env` | Re-run `--login`; confirm write messages list file paths |
| Postgres refused | Start service; fix `DATABASE_URL` |
| OpenAI errors | Keep `MODEL_PRIMARY=copilot:gpt-4o` after login |
