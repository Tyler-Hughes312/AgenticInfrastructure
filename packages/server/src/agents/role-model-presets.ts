/** AWS Bedrock GPT-OSS-120B — used by supervisor and every worker/subagent. */
export const BEDROCK_GPT_OSS_120B = "bedrock:openai.gpt-oss-120b-1:0";

/**
 * All agent roles use AWS Bedrock GPT-OSS-120B.
 * Role heuristics are retained for future cost-tiering; today every preset is identical.
 */
export const ROLE_MODEL_PRESETS = {
  light: BEDROCK_GPT_OSS_120B,
  plan: BEDROCK_GPT_OSS_120B,
  code: BEDROCK_GPT_OSS_120B,
  review: BEDROCK_GPT_OSS_120B,
  default: BEDROCK_GPT_OSS_120B,
} as const;

export type RoleModelKind = keyof typeof ROLE_MODEL_PRESETS;

/**
 * Model for a newly created / designed agent.
 * Always AWS Bedrock GPT-OSS-120B (ignores legacy Copilot/OpenAI env for subagents).
 */
export function suggestModelForRole(_params?: {
  label?: string;
  role?: string;
  tools?: string[];
  produces?: string;
  consumes?: string;
}): string {
  void _params;
  return BEDROCK_GPT_OSS_120B;
}

export function shortModelLabel(providerModel: string | undefined): string {
  if (!providerModel?.trim()) return "default";
  const idx = providerModel.indexOf(":");
  return idx >= 0 ? providerModel.slice(idx + 1) : providerModel;
}
