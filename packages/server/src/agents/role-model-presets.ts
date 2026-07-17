import { env } from "../config.js";
import type { ToolName } from "./agent-registry.js";

/** Copilot (or OpenAI) model presets by agent role. */
export const ROLE_MODEL_PRESETS = {
  light: "copilot:gpt-4o-mini",
  plan: "copilot:gpt-4.1",
  code: "copilot:gpt-4o",
  review: "copilot:gpt-4.1",
  default: "copilot:gpt-4o",
} as const;

export type RoleModelKind = keyof typeof ROLE_MODEL_PRESETS;

/**
 * Pick a model for an agent from its label/role/tools.
 * Light/classify → mini; plan/research/review → 4.1; code/build → 4o.
 */
export function suggestModelForRole(params: {
  label?: string;
  role?: string;
  tools?: string[];
  produces?: string;
  consumes?: string;
}): string {
  const blob = [
    params.label,
    params.role,
    params.produces,
    params.consumes,
    ...(params.tools ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const tools = params.tools ?? [];
  const writesCode =
    tools.includes("write_file" as ToolName) ||
    tools.includes("edit_file" as ToolName) ||
    /\b(implement|build|code|develop|engineer|frontend|backend|full.?stack|coder|dev)\b/.test(blob);

  if (
    /\b(classif|route|triage|lightweight|fast|cheap|mini)\b/.test(blob) &&
    !writesCode
  ) {
    return ROLE_MODEL_PRESETS.light;
  }

  if (
    /\b(review|qa|quality|audit|critique|test|tester)\b/.test(blob) &&
    !writesCode
  ) {
    return ROLE_MODEL_PRESETS.review;
  }

  if (
    /\b(plan|planner|pm|product|architect|design|research|investigate|analyst)\b/.test(blob) &&
    !writesCode
  ) {
    return ROLE_MODEL_PRESETS.plan;
  }

  if (writesCode) {
    return ROLE_MODEL_PRESETS.code;
  }

  return env.MODEL_PRIMARY?.trim() || ROLE_MODEL_PRESETS.default;
}

export function shortModelLabel(providerModel: string | undefined): string {
  if (!providerModel?.trim()) return "default";
  const parts = providerModel.split(":");
  return parts[parts.length - 1] || providerModel;
}
