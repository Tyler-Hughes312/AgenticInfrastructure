import { resolveCredentials } from "./credentials/store.js";
import {
  getCachedCopilotToken,
  invalidateCopilotSession,
  refreshCopilotSession,
  COPILOT_AUTH_HELP,
} from "./auth/copilot-token.js";

export function isLlmAuthError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    const msg = String(err);
    return /401|token expired|MODEL_AUTHENTICATION|unauthorized|api key/i.test(msg);
  }
  const o = err as { status?: number; message?: string; lc_error_code?: string };
  if (o.status === 401) return true;
  if (o.lc_error_code === "MODEL_AUTHENTICATION") return true;
  const msg = o.message ?? String(err);
  return /401|token expired|MODEL_AUTHENTICATION|unauthorized|api key/i.test(msg);
}

export function formatLlmError(err: unknown): string {
  if (isLlmAuthError(err)) {
    return (
      "LLM authentication failed. Run `npm run copilot-login -w @agentic/server`, " +
      "ensure MODEL_PRIMARY=copilot:gpt-4o, or set OPENAI_API_KEY for openai: models.\n" +
      COPILOT_AUTH_HELP
    );
  }
  return err instanceof Error ? err.message : String(err);
}

export function assertLlmReady(): void {
  const creds = resolveCredentials();
  if (creds.githubCopilotToken?.trim() || getCachedCopilotToken()) return;
  if (creds.openaiApiKey?.trim()) return;
  throw new Error(
    "No LLM credentials. Run `npm run copilot-login -w @agentic/server` (recommended) or set OPENAI_API_KEY."
  );
}

/** Invalidate session and re-exchange once. Returns true if a fresh token is available. */
export async function recoverCopilotAuth(): Promise<boolean> {
  invalidateCopilotSession();
  return refreshCopilotSession();
}
