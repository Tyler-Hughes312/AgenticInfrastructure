import { ChatOpenAI } from "@langchain/openai";
import { ChatBedrockConverse } from "@langchain/aws";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { OpenAIEmbeddings } from "@langchain/openai";
import { env } from "./config.js";
import { resolveCredentials } from "./credentials/store.js";
import type { RunCredentials } from "./credentials/types.js";
import { BEDROCK_GPT_OSS_120B } from "./agents/role-model-presets.js";

export { BEDROCK_GPT_OSS_120B };

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

function hasCopilotCredentials(creds: RunCredentials): boolean {
  return Boolean(creds.githubCopilotToken || creds.githubToken);
}

/** Bedrock uses the AWS default credential chain (env keys, profile, or IAM role). */
function hasBedrockCredentials(): boolean {
  return Boolean(
    process.env.AWS_ACCESS_KEY_ID ||
      process.env.AWS_PROFILE ||
      process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
      process.env.AWS_WEB_IDENTITY_TOKEN_FILE ||
      env.BEDROCK_ENABLED
  );
}

function hasProviderCredentials(provider: string, creds: RunCredentials): boolean {
  if (provider === "bedrock") return hasBedrockCredentials();
  if (provider === "copilot") return hasCopilotCredentials(creds);
  if (provider === "openai") return Boolean(creds.openaiApiKey);
  return false;
}

function extraCandidatesForCredentials(creds: RunCredentials): string[] {
  const extras: string[] = [];
  if (hasBedrockCredentials()) {
    extras.push(BEDROCK_GPT_OSS_120B);
  }
  if (hasCopilotCredentials(creds)) {
    extras.push("copilot:gpt-4o", "copilot:gpt-4.1", "copilot:gpt-4o-mini");
  }
  if (creds.openaiApiKey) {
    extras.push("openai:gpt-4o", "openai:gpt-4.1");
  }
  return extras;
}

/**
 * Choose a model the current credentials can actually authenticate.
 * Prefers configured primary/fallback, then only providers with credentials.
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
    ...extraCandidatesForCredentials(creds),
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
      "No LLM credentials available. Configure AWS credentials for bedrock:openai.gpt-oss-120b-1:0 " +
        "(AWS_PROFILE / AWS_ACCESS_KEY_ID), or run `npm run copilot-login -w @agentic/server`, or set OPENAI_API_KEY."
    );
  }

  const primary = usable[0];
  const fallback = usable.find((spec) => spec !== primary) ?? null;
  return { primary, fallback };
}

function buildModel(providerModel: string, credentials?: RunCredentials): BaseChatModel {
  const creds = resolveCredentials(credentials);
  const [provider, model] = assertModelAllowed(providerModel);

  if (provider === "bedrock") {
    return new ChatBedrockConverse({
      model,
      region: env.BEDROCK_REGION,
      temperature: 0,
      maxTokens: 8192,
      tags: [providerModel],
      metadata: { ls_model_name: providerModel, model: providerModel },
    });
  }

  if (provider === "copilot") {
    const token = creds.githubCopilotToken ?? creds.githubToken;
    if (!token) {
      throw new Error(
        "GitHub Copilot token required. Run `npm run copilot-login -w @agentic/server`, or set GITHUB_COPILOT_TOKEN / GITHUB_TOKEN."
      );
    }
    return new ChatOpenAI({
      model,
      temperature: 0,
      apiKey: token,
      tags: [providerModel],
      metadata: { ls_model_name: providerModel, model: providerModel },
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
        "OpenAI API key required for this model. Set OPENAI_API_KEY or switch MODEL_PRIMARY to bedrock:openai.gpt-oss-120b-1:0."
      );
    }
    if (apiKey.includes("unused-wrapper") || apiKey === "unused-wrapper") {
      throw new Error("Internal error: refusing placeholder OpenAI API key.");
    }
    return new ChatOpenAI({
      model,
      temperature: 0,
      apiKey,
      tags: [providerModel],
      metadata: { ls_model_name: providerModel, model: providerModel },
    });
  }

  throw new Error(
    `Unsupported model provider: ${provider}. Use bedrock:, copilot:, or openai:`
  );
}

function resolveModelNow(_useFallback = true): BaseChatModel {
  const creds = resolveCredentials();
  const { primary: primaryModel } = selectAuthenticatedModels(creds);

  if (providerOf(primaryModel) !== providerOf(creds.modelPrimary ?? env.MODEL_PRIMARY)) {
    console.warn(
      `Using ${primaryModel} because configured primary lacks credentials ` +
        `(have bedrock=${hasBedrockCredentials()} openai=${Boolean(creds.openaiApiKey)} copilot=${hasCopilotCredentials(creds)})`
    );
  }

  return buildModel(primaryModel, creds);
}

export function getModel(useFallback = true): BaseChatModel {
  return resolveModelNow(useFallback);
}

export function getModelForAgent(modelOverride?: string, useFallback = true): BaseChatModel {
  // Supervisor + workers: prefer Bedrock GPT-OSS-120B whenever Bedrock is enabled.
  if (env.BEDROCK_ENABLED && hasBedrockCredentials()) {
    const requested = modelOverride?.trim();
    if (requested?.startsWith("bedrock:")) {
      return buildModel(requested);
    }
    return buildModel(BEDROCK_GPT_OSS_120B);
  }

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
    throw new Error(
      "OpenAI API key required for embeddings. Set OPENAI_API_KEY or use MEMORY_STORE=inmemory (semantic search disabled)."
    );
  }
  return new OpenAIEmbeddings({
    model,
    apiKey: creds.openaiApiKey,
  });
}
