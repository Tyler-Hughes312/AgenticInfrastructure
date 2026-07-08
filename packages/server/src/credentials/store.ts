import { AsyncLocalStorage } from "node:async_hooks";
import type { RunCredentials } from "./types.js";
import { env } from "../config.js";

const storage = new AsyncLocalStorage<RunCredentials>();

export function getActiveCredentials(): RunCredentials {
  return storage.getStore() ?? {};
}

export function resolveCredentials(overrides?: RunCredentials): RunCredentials {
  const active = getActiveCredentials();
  return {
    githubToken: overrides?.githubToken || active.githubToken || env.GITHUB_TOKEN || undefined,
    githubCopilotToken:
      overrides?.githubCopilotToken || active.githubCopilotToken || env.GITHUB_COPILOT_TOKEN || undefined,
    openaiApiKey: overrides?.openaiApiKey || active.openaiApiKey || env.OPENAI_API_KEY || undefined,
    modelPrimary: overrides?.modelPrimary || active.modelPrimary || env.MODEL_PRIMARY,
    modelFallback: overrides?.modelFallback || active.modelFallback || env.MODEL_FALLBACK,
    defaultRepoUrl: overrides?.defaultRepoUrl || active.defaultRepoUrl || env.DEFAULT_REPO_URL || undefined,
    langfusePublicKey:
      overrides?.langfusePublicKey || active.langfusePublicKey || env.LANGFUSE_PUBLIC_KEY || undefined,
    langfuseSecretKey:
      overrides?.langfuseSecretKey || active.langfuseSecretKey || env.LANGFUSE_SECRET_KEY || undefined,
  };
}

export async function runWithCredentials<T>(
  credentials: RunCredentials,
  fn: () => Promise<T>
): Promise<T> {
  return storage.run(credentials, fn);
}
