import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { RunnableConfig } from "@langchain/core/runnables";
import { getRunContextFromConfig } from "./context.js";

export type HandoffRecord = {
  fromAgent: string;
  artifactType: string;
  payload: string;
  ts: number;
};

const handoffsByRun = new Map<string, HandoffRecord[]>();

export function clearPipelineHandoffs(runId: string): void {
  handoffsByRun.delete(runId);
}

export function getPipelineHandoffs(runId: string): HandoffRecord[] {
  return handoffsByRun.get(runId) ?? [];
}

export function formatHandoffsForPrompt(records: HandoffRecord[]): string {
  if (!records.length) return "(no upstream handoffs yet)";
  return records
    .map(
      (h, i) =>
        `${i + 1}. **${h.fromAgent}** (${h.artifactType})\n${h.payload.slice(0, 4000)}`
    )
    .join("\n\n---\n\n");
}

function agentIdFromConfig(config?: RunnableConfig): string {
  const meta = config?.metadata as Record<string, unknown> | undefined;
  const node = meta?.langgraph_node;
  if (typeof node === "string" && node && node !== "supervisor") return node;
  return "unknown_agent";
}

export const publishHandoff = tool(
  async ({ artifact_type, payload }, config: RunnableConfig) => {
    const ctx = getRunContextFromConfig(config);
    const fromAgent = agentIdFromConfig(config);
    const record: HandoffRecord = {
      fromAgent,
      artifactType: artifact_type,
      payload: payload.trim(),
      ts: Date.now(),
    };
    const list = handoffsByRun.get(ctx.runId) ?? [];
    list.push(record);
    handoffsByRun.set(ctx.runId, list);
    return `Handoff published from ${fromAgent} (${artifact_type}, ${payload.length} chars). Downstream agents can read_pipeline_context.`;
  },
  {
    name: "publish_handoff",
    description:
      "REQUIRED before finishing: publish structured output for downstream agents. " +
      "Include all facts, outlines, drafts, or decisions the next agent needs.",
    schema: z.object({
      artifact_type: z
        .string()
        .describe("Short label e.g. research_notes, outline, draft_essay, review_feedback"),
      payload: z.string().describe("Full structured content for downstream agents"),
    }),
  }
);

export const readPipelineContext = tool(
  async (_input, config: RunnableConfig) => {
    const ctx = getRunContextFromConfig(config);
    const records = getPipelineHandoffs(ctx.runId);
    if (!records.length) {
      return "No upstream handoffs yet. If you are first in the pipeline, proceed from the user task.";
    }
    return `## Upstream pipeline handoffs\n\n${formatHandoffsForPrompt(records)}`;
  },
  {
    name: "read_pipeline_context",
    description:
      "Read all upstream agent handoffs for this run. Call this FIRST before doing your work.",
    schema: z.object({}),
  }
);
