export interface RunCredentials {
  githubToken?: string;
  githubCopilotToken?: string;
  openaiApiKey?: string;
  modelPrimary?: string;
  modelFallback?: string;
  defaultRepoUrl?: string;
  langfusePublicKey?: string;
  langfuseSecretKey?: string;
}

export interface CredentialsStatus {
  github_token: boolean;
  github_copilot_token: boolean;
  openai_api_key: boolean;
  model_primary: string;
  model_fallback: string;
  default_repo_url: string;
  langfuse_configured: boolean;
  source: "env" | "request" | "mixed";
}
