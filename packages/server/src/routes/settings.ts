import type { FastifyInstance } from "fastify";
import { env } from "../config.js";
import { parseCredentialsFromRequest } from "../credentials/parse.js";
import { resolveCredentials } from "../credentials/store.js";
import type { CredentialsStatus } from "../credentials/types.js";
import { getRoutingPolicyForApi } from "../agents/routing-policy.js";

function buildCredentialsStatus(overrides?: ReturnType<typeof parseCredentialsFromRequest>): CredentialsStatus {
  const resolved = resolveCredentials(overrides);
  const hasRequestOverrides = Boolean(
    overrides &&
      (overrides.githubToken ||
        overrides.githubCopilotToken ||
        overrides.openaiApiKey ||
        overrides.defaultRepoUrl)
  );
  const hasEnv =
    Boolean(env.GITHUB_TOKEN) ||
    Boolean(env.GITHUB_COPILOT_TOKEN) ||
    Boolean(env.OPENAI_API_KEY) ||
    Boolean(env.DEFAULT_REPO_URL);

  return {
    github_token: Boolean(resolved.githubToken),
    github_copilot_token: Boolean(resolved.githubCopilotToken),
    openai_api_key: Boolean(resolved.openaiApiKey),
    model_primary: resolved.modelPrimary ?? env.MODEL_PRIMARY,
    model_fallback: resolved.modelFallback ?? env.MODEL_FALLBACK,
    default_repo_url: resolved.defaultRepoUrl ?? env.DEFAULT_REPO_URL ?? "",
    langfuse_configured: Boolean(resolved.langfusePublicKey && resolved.langfuseSecretKey),
    source: hasRequestOverrides && hasEnv ? "mixed" : hasRequestOverrides ? "request" : "env",
  };
}

export async function settingsRoutes(app: FastifyInstance) {
  app.get("/api/settings/status", async (req) => {
    const overrides = parseCredentialsFromRequest(req);
    return buildCredentialsStatus(overrides);
  });

  app.post("/api/settings/status", async (req) => {
    const overrides = parseCredentialsFromRequest(req);
    return buildCredentialsStatus(overrides);
  });

  app.get("/api/settings/routing", async () => getRoutingPolicyForApi());
}
