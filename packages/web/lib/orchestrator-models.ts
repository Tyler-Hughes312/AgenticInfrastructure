import { loadCredentials } from "./credentials";

const BASE_MODELS = [
  "",
  "copilot:gpt-4o",
  "copilot:gpt-4.1",
  "openai:gpt-4.1",
  "openai:gpt-4o",
  "openai:gpt-4o-mini",
];

export function getAvailableModelOptions(): string[] {
  const creds = loadCredentials();
  const extra = [creds.modelPrimary, creds.modelFallback].filter(Boolean);
  return [...new Set([...BASE_MODELS, ...extra])];
}
