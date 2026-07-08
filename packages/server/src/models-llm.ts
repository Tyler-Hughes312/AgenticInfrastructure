import { OpenAIEmbeddings, ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { env } from "./config.js";
import { resolveCredentials } from "./credentials/store.js";
import type { RunCredentials } from "./credentials/types.js";

const BLOCKED = ["anthropic", "claude"];

export function assertModelAllowed(providerModel: string): [string, string] {
  const lower = providerModel.toLowerCase();
  for (const frag of BLOCKED) {
    if (lower.includes(frag)) {
      throw new Error(`Anthropic models are excluded. Refused: ${providerModel}`);
    }
  }
  const [provider, ...rest] = providerModel.split(":");
  const model = rest.join(":");
  if (provider === "anthropic") {
    throw new Error("Anthropic provider is excluded.");
  }
  if (!model) throw new Error(`Invalid model format: ${providerModel}`);
  return [provider, model];
}

function providerOf(providerModel: string): string {
  return providerModel.split(":")[0] ?? "";
}

function hasProviderCredentials(provider: string, creds: RunCredentials): boolean {
  if (provider === "copilot") return Boolean(creds.githubCopilotToken);
  if (provider === "openai") return Boolean(creds.openaiApiKey);
  return false;
}

/**
 * Choose a model the current credentials can actually authenticate.
 * If the configured primary lacks credentials, fall back to a provider that does.
 */
export function selectAuthenticatedModels(creds: RunCredentials): {
  primary: string;
  fallback: string | null;
} {
  const configuredPrimary = creds.modelPrimary ?? env.MODEL_PRIMARY;
  const configuredFallback = creds.modelFallback ?? env.MODEL_FALLBACK;
  assertModelAllowed(configuredPrimary);
  assertModelAllowed(configuredFallback);

  const candidates = [
    configuredPrimary,
    configuredFallback,
    "openai:gpt-4o",
    "openai:gpt-4.1",
    "copilot:gpt-4o",
  ];

  const usable = [...new Set(candidates)].filter((spec) => {
    try {
      const [provider] = assertModelAllowed(spec);
      return hasProviderCredentials(provider, creds);
    } catch {
      return false;
    }
  });

  if (!usable.length) {
    throw new Error(
      "No LLM credentials available. Set OPENAI_API_KEY (or Copilot token) in the repo-root .env, or in Settings."
    );
  }

  const primary = usable[0];
  const fallback = usable.find((spec) => spec !== primary) ?? null;
  return { primary, fallback };
}

function buildModel(providerModel: string, credentials?: RunCredentials): ChatOpenAI {
  const creds = resolveCredentials(credentials);
  const [provider, model] = assertModelAllowed(providerModel);

  if (provider === "copilot") {
    const token = creds.githubCopilotToken;
    if (!token) {
      throw new Error(
        "GitHub Copilot token required. Set GITHUB_COPILOT_TOKEN in .env or Settings."
      );
    }
    // Copilot serves OpenAI-compatible routes at /chat/completions (no /v1 prefix).
    return new ChatOpenAI({
      model,
      temperature: 0,
      apiKey: token,
      configuration: {
        baseURL: "https://api.githubcopilot.com",
        defaultHeaders: {
          "Editor-Version": "vscode/1.85.0",
          "Editor-Plugin-Version": "copilot-chat/0.26.7",
          "Copilot-Integration-Id": "vscode-chat",
          "User-Agent": "GitHubCopilotChat/0.26.7",
          "Openai-Intent": "conversation-edits",
        },
      },
    });
  }

  if (provider === "openai") {
    const apiKey = creds.openaiApiKey;
    if (!apiKey) {
      throw new Error(
        "OpenAI API key required. Set OPENAI_API_KEY in the repo-root .env or in Settings."
      );
    }
    if (apiKey.includes("unused-wrapper") || apiKey === "unused-wrapper") {
      throw new Error("Internal error: refusing placeholder OpenAI API key.");
    }
    return new ChatOpenAI({
      model,
      temperature: 0,
      apiKey,
    });
  }

  throw new Error(`Unsupported model provider: ${provider}. Use copilot: or openai:`);
}

/**
 * Always returns a real ChatOpenAI with a real API key.
 * Never return ChatOpenAI subclasses with placeholder keys — LangGraph bindTools
 * will call the OpenAI client on the wrapper itself and leak those placeholders.
 */
function resolveModelNow(_useFallback = true): ChatOpenAI {
  const creds = resolveCredentials();
  const { primary: primaryModel } = selectAuthenticatedModels(creds);

  if (providerOf(primaryModel) !== providerOf(creds.modelPrimary ?? env.MODEL_PRIMARY)) {
    console.warn(
      `Using ${primaryModel} because configured primary lacks credentials (have openai=${Boolean(creds.openaiApiKey)} copilot=${Boolean(creds.githubCopilotToken)})`
    );
  }

  return buildModel(primaryModel, creds);
}

export function getModel(useFallback = true): BaseChatModel {
  return resolveModelNow(useFallback);
}

export function getModelForAgent(modelOverride?: string, useFallback = true): BaseChatModel {
  if (!modelOverride?.trim()) return getModel(useFallback);
  const creds = resolveCredentials();
  const override = modelOverride.trim();
  try {
    const [provider] = assertModelAllowed(override);
    if (hasProviderCredentials(provider, creds)) {
      return buildModel(override, creds);
    }
  } catch {
    // fall through
  }
  return getModel(useFallback);
}

export function getEmbeddings(credentials?: RunCredentials) {
  const creds = resolveCredentials(credentials);
  const [, model] = assertModelAllowed(env.EMBEDDING_MODEL);
  if (!creds.openaiApiKey) {
    throw new Error("OpenAI API key required for embeddings. Set OPENAI_API_KEY in .env.");
  }
  return new OpenAIEmbeddings({
    model,
    apiKey: creds.openaiApiKey,
  });
}
