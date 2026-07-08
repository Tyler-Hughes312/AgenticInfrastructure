import type { FastifyRequest } from "fastify";
import type { RunCredentials } from "./types.js";

function pickString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

export function parseCredentialsFromBody(body: unknown): RunCredentials {
  if (!body || typeof body !== "object") return {};
  const b = body as Record<string, unknown>;
  const nested =
    b.credentials && typeof b.credentials === "object"
      ? (b.credentials as Record<string, unknown>)
      : b;

  return {
    githubToken: pickString(nested.github_token ?? nested.githubToken),
    githubCopilotToken: pickString(nested.github_copilot_token ?? nested.githubCopilotToken),
    openaiApiKey: pickString(nested.openai_api_key ?? nested.openaiApiKey),
    modelPrimary: pickString(nested.model_primary ?? nested.modelPrimary),
    modelFallback: pickString(nested.model_fallback ?? nested.modelFallback),
    defaultRepoUrl: pickString(nested.default_repo_url ?? nested.defaultRepoUrl),
    langfusePublicKey: pickString(nested.langfuse_public_key ?? nested.langfusePublicKey),
    langfuseSecretKey: pickString(nested.langfuse_secret_key ?? nested.langfuseSecretKey),
  };
}

export function parseCredentialsFromRequest(req: FastifyRequest): RunCredentials {
  const headers = req.headers;
  const fromHeaders: RunCredentials = {
    githubToken: pickString(headers["x-github-token"]),
    githubCopilotToken: pickString(headers["x-github-copilot-token"]),
    openaiApiKey: pickString(headers["x-openai-api-key"]),
    modelPrimary: pickString(headers["x-model-primary"]),
    modelFallback: pickString(headers["x-model-fallback"]),
    defaultRepoUrl: pickString(headers["x-default-repo-url"]),
    langfusePublicKey: pickString(headers["x-langfuse-public-key"]),
    langfuseSecretKey: pickString(headers["x-langfuse-secret-key"]),
  };

  const fromBody = parseCredentialsFromBody(req.body);
  return {
    githubToken: fromBody.githubToken ?? fromHeaders.githubToken,
    githubCopilotToken: fromBody.githubCopilotToken ?? fromHeaders.githubCopilotToken,
    openaiApiKey: fromBody.openaiApiKey ?? fromHeaders.openaiApiKey,
    modelPrimary: fromBody.modelPrimary ?? fromHeaders.modelPrimary,
    modelFallback: fromBody.modelFallback ?? fromHeaders.modelFallback,
    defaultRepoUrl: fromBody.defaultRepoUrl ?? fromHeaders.defaultRepoUrl,
    langfusePublicKey: fromBody.langfusePublicKey ?? fromHeaders.langfusePublicKey,
    langfuseSecretKey: fromBody.langfuseSecretKey ?? fromHeaders.langfuseSecretKey,
  };
}
