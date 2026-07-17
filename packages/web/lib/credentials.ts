export interface StoredCredentials {
  githubToken: string;
  githubCopilotToken: string;
  openaiApiKey: string;
  modelPrimary: string;
  modelFallback: string;
  defaultRepoUrl: string;
  langfusePublicKey: string;
  langfuseSecretKey: string;
}

const STORAGE_KEY = "agentic-platform-credentials";

export const DEFAULT_CREDENTIALS: StoredCredentials = {
  githubToken: "",
  githubCopilotToken: "",
  openaiApiKey: "",
  modelPrimary: "bedrock:openai.gpt-oss-120b-1:0",
  modelFallback: "bedrock:openai.gpt-oss-120b-1:0",
  defaultRepoUrl: "",
  langfusePublicKey: "",
  langfuseSecretKey: "",
};

export function loadCredentials(): StoredCredentials {
  if (typeof window === "undefined") return { ...DEFAULT_CREDENTIALS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CREDENTIALS };
    return { ...DEFAULT_CREDENTIALS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CREDENTIALS };
  }
}

export function saveCredentials(credentials: StoredCredentials): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials));
}

export function credentialsToPayload(credentials: StoredCredentials) {
  return {
    github_token: credentials.githubToken || undefined,
    github_copilot_token: credentials.githubCopilotToken || undefined,
    openai_api_key: credentials.openaiApiKey || undefined,
    model_primary: credentials.modelPrimary || undefined,
    model_fallback: credentials.modelFallback || undefined,
    default_repo_url: credentials.defaultRepoUrl || undefined,
    langfuse_public_key: credentials.langfusePublicKey || undefined,
    langfuse_secret_key: credentials.langfuseSecretKey || undefined,
  };
}

export function credentialsHeaders(credentials: StoredCredentials): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (credentials.githubToken) headers["x-github-token"] = credentials.githubToken;
  if (credentials.githubCopilotToken) headers["x-github-copilot-token"] = credentials.githubCopilotToken;
  if (credentials.openaiApiKey) headers["x-openai-api-key"] = credentials.openaiApiKey;
  if (credentials.modelPrimary) headers["x-model-primary"] = credentials.modelPrimary;
  if (credentials.modelFallback) headers["x-model-fallback"] = credentials.modelFallback;
  if (credentials.defaultRepoUrl) headers["x-default-repo-url"] = credentials.defaultRepoUrl;
  if (credentials.langfusePublicKey) headers["x-langfuse-public-key"] = credentials.langfusePublicKey;
  if (credentials.langfuseSecretKey) headers["x-langfuse-secret-key"] = credentials.langfuseSecretKey;
  return headers;
}

export function hasMinimumCredentials(credentials: StoredCredentials): boolean {
  const hasLlm = Boolean(credentials.githubCopilotToken || credentials.openaiApiKey);
  return hasLlm;
}

export function needsGithubCredentials(credentials: StoredCredentials): boolean {
  return Boolean(credentials.defaultRepoUrl) || Boolean(credentials.githubToken);
}
