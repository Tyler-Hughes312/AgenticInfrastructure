import { resolveCredentials } from "./credentials/store.js";

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
      "LLM authentication failed. Set OPENAI_API_KEY in the repo-root .env or in Settings, " +
      "and ensure MODEL_PRIMARY=openai:gpt-4o (or another openai: model)."
    );
  }
  return err instanceof Error ? err.message : String(err);
}

export function assertLlmReady(): void {
  const creds = resolveCredentials();
  if (creds.openaiApiKey?.trim()) return;
  if (creds.githubCopilotToken?.trim()) return;
  throw new Error(
    "No LLM credentials. Set OPENAI_API_KEY in .env (recommended) or GITHUB_COPILOT_TOKEN in Settings."
  );
}
