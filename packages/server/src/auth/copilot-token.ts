import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../config.js";
import { exchangeCopilotToken } from "./copilot.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../..");
const TOKEN_CACHE = resolve(REPO_ROOT, ".copilot_token");
const OAUTH_CACHE = resolve(REPO_ROOT, ".copilot_oauth");

export const COPILOT_AUTH_HELP =
  "GitHub Copilot session token is missing or expired. Refresh it with:\n" +
  "  npm run copilot-login -w @agentic/server\n" +
  "This stores GITHUB_COPILOT_OAUTH_TOKEN (refresh) and GITHUB_COPILOT_TOKEN (session).\n" +
  "(A GitHub PAT with Copilot access can also refresh; repo push still needs GITHUB_TOKEN separately.)";

let cachedSession: string | undefined;
let ignoreEnvCopilotToken = false;

/** Copilot IDE tokens embed exp= as unix seconds (semicolon-delimited). */
export function isCopilotTokenExpired(token: string): boolean {
  const match = token.match(/(?:^|;)\s*exp=(\d+)/);
  if (!match) return false;
  const exp = Number(match[1]);
  if (!Number.isFinite(exp)) return false;
  return Date.now() / 1000 >= exp - 30;
}

function usableToken(token: string | undefined): string | undefined {
  if (!token?.trim()) return undefined;
  if (isCopilotTokenExpired(token)) return undefined;
  return token.trim();
}

export function invalidateCopilotSession(): void {
  ignoreEnvCopilotToken = true;
  cachedSession = undefined;
}

function readOauthRefreshSource(): string | undefined {
  const fromEnv = env.GITHUB_COPILOT_OAUTH_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  if (existsSync(OAUTH_CACHE)) {
    const fromFile = readFileSync(OAUTH_CACHE, "utf-8").trim();
    if (fromFile) return fromFile;
  }
  return env.GITHUB_TOKEN?.trim() || undefined;
}

function persistSessionToken(token: string): void {
  cachedSession = token;
  try {
    writeFileSync(TOKEN_CACHE, token);
  } catch {
    /* best-effort cache */
  }
}

/** Copilot session token from env, refresh cache, or copilot-login file. */
export function getCachedCopilotToken(): string | undefined {
  if (!ignoreEnvCopilotToken) {
    const fromEnv = usableToken(env.GITHUB_COPILOT_TOKEN);
    if (fromEnv) return fromEnv;
  }
  const fromCache = usableToken(cachedSession);
  if (fromCache) return fromCache;
  if (existsSync(TOKEN_CACHE)) {
    return usableToken(readFileSync(TOKEN_CACHE, "utf-8").trim());
  }
  return undefined;
}

export function assertCopilotReady(): void {
  const token = getCachedCopilotToken();
  if (token) return;

  const envRaw = env.GITHUB_COPILOT_TOKEN?.trim();
  if (envRaw && isCopilotTokenExpired(envRaw)) {
    throw new Error(
      `GitHub Copilot token expired (${formatCopilotExpiry(envRaw)}).\n${COPILOT_AUTH_HELP}`
    );
  }
  throw new Error(COPILOT_AUTH_HELP);
}

function formatCopilotExpiry(token: string): string {
  const match = token.match(/(?:^|;)\s*exp=(\d+)/);
  if (!match) return "unknown date";
  return new Date(Number(match[1]) * 1000).toISOString();
}

/** Exchange OAuth/PAT for a fresh session token. Returns true on success. */
export async function refreshCopilotSession(): Promise<boolean> {
  const refresh = readOauthRefreshSource();
  if (!refresh) return false;
  try {
    const session = await exchangeCopilotToken(refresh);
    ignoreEnvCopilotToken = true;
    persistSessionToken(session);
    console.log("[copilot] Refreshed Copilot session token.");
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[copilot] Could not refresh Copilot token (${msg}).\n${COPILOT_AUTH_HELP}`);
    return false;
  }
}

/** Refresh when session missing/expired; OAuth first, then GITHUB_TOKEN PAT. */
export async function warmCopilotTokenFromEnv(): Promise<void> {
  if (getCachedCopilotToken()) return;

  const envRaw = env.GITHUB_COPILOT_TOKEN?.trim();
  if (envRaw && isCopilotTokenExpired(envRaw)) {
    console.warn(
      `[copilot] GITHUB_COPILOT_TOKEN expired (${formatCopilotExpiry(envRaw)}). Attempting refresh…`
    );
    ignoreEnvCopilotToken = true;
  }

  const ok = await refreshCopilotSession();
  if (!ok && (ignoreEnvCopilotToken || !getCachedCopilotToken())) {
    if (!readOauthRefreshSource()) {
      console.error(`[copilot] No valid token.\n${COPILOT_AUTH_HELP}`);
    }
  }
}
