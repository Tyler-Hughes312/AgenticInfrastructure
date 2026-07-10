import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../config.js";
import { exchangeCopilotToken } from "./copilot.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../..");
const TOKEN_CACHE = resolve(REPO_ROOT, ".copilot_token");

export const COPILOT_AUTH_HELP =
  "GitHub Copilot session token is missing or expired. Refresh it with:\n" +
  "  npm run copilot-login -w @agentic/server\n" +
  "Then paste the new GITHUB_COPILOT_TOKEN into packages/server/.env and restart the server.\n" +
  "(A GitHub PAT is used for git push/PR only — it cannot replace the Copilot chat token.)";

let cachedFromPat: string | undefined;
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
  cachedFromPat = undefined;
}

/** Copilot session token from env, PAT exchange cache, or copilot-login file. */
export function getCachedCopilotToken(): string | undefined {
  if (!ignoreEnvCopilotToken) {
    const fromEnv = usableToken(env.GITHUB_COPILOT_TOKEN);
    if (fromEnv) return fromEnv;
  }
  const fromPat = usableToken(cachedFromPat);
  if (fromPat) return fromPat;
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

/** Refresh Copilot token when env token is expired; try PAT exchange as a last resort. */
export async function warmCopilotTokenFromEnv(): Promise<void> {
  if (getCachedCopilotToken()) return;

  const envRaw = env.GITHUB_COPILOT_TOKEN?.trim();
  if (envRaw && isCopilotTokenExpired(envRaw)) {
    console.warn(
      `[copilot] GITHUB_COPILOT_TOKEN expired (${formatCopilotExpiry(envRaw)}). Attempting refresh…`
    );
    ignoreEnvCopilotToken = true;
  }

  const pat = env.GITHUB_TOKEN?.trim();
  if (!pat) {
    if (ignoreEnvCopilotToken) {
      console.error(`[copilot] No valid token.\n${COPILOT_AUTH_HELP}`);
    }
    return;
  }

  try {
    cachedFromPat = await exchangeCopilotToken(pat);
    console.log("[copilot] Exchanged GITHUB_TOKEN for Copilot API token.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (ignoreEnvCopilotToken || !getCachedCopilotToken()) {
      console.error(
        `[copilot] Could not refresh Copilot token (${msg}).\n${COPILOT_AUTH_HELP}`
      );
    }
  }
}
