import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getModel } from "../models-llm.js";
import { parseGraphEditCommand, type GraphEditCommand } from "./graph-edit.js";
import type { CustomAgentConfig } from "./agent-registry.js";
import {
  graphContextForDirectReply,
  looksLikeDirectChat,
  isTeamStructureOnly,
  looksLikeGraphDesignRequest,
  looksLikeGraphMetaQuestion,
  looksLikePipelineTask,
  looksLikeProductDeliverable,
} from "./pipeline-gate.js";

export type MessageIntent =
  | { kind: "graph_edit"; command: GraphEditCommand }
  | { kind: "graph_edit_pending"; description: string; command: GraphEditCommand | null; confidence: number }
  | { kind: "graph_design" }
  | { kind: "task_run" }
  | { kind: "q_and_a" };

const CLASSIFIER_SYSTEM = `You classify orchestrator chat messages into one of four intents.
Return JSON only — no prose, no markdown fences:
{ "intent": "graph_edit" | "graph_design" | "task_run" | "q_and_a", "confidence": <0.0-1.0>, "edit_description": "<string>" }

Definitions:
- graph_edit: structural canvas changes ONLY — add/remove/connect/disconnect/rename/rebuild agents or edges (explicit edits)
- graph_design: user wants to CREATE or EXTEND the agent team / pipeline on the canvas (e.g. "build a software dev team", "add subagents", "make a discovery team")
- task_run: user wants deployed agents to EXECUTE work on a deliverable (build an app, research and write, push code, etc.)
- q_and_a: conversation, explanations, questions, greetings — NO canvas changes and NO agent execution

IMPORTANT: Default to q_and_a when unsure.
- "make a full software dev team" → graph_design (canvas structure)
- "build a todo app" → task_run (product work)
- "what agents do I have?" → q_and_a

Examples of graph_design:
- "Build me a discovery team into a software dev team infrastructure"
- "Make a full software dev team with subagents"
- "Add QA and DevOps agents to the pipeline"

Examples of q_and_a:
- "What agents are in the graph?"
- "How does the supervisor work?"
- "Thanks!"

Examples of task_run:
- "Research jazz history and write a 200-word essay"
- "Build a todo app and push to GitHub"
- "Create a GitHub repository for this project and scaffold a Next.js app"
- "Run the pipeline on this task"

edit_description: plain English summary of the edit if intent is graph_edit.
Leave empty string for graph_design, task_run and q_and_a.`;

export async function classifyMessageIntent(
  text: string,
  agents: CustomAgentConfig[]
): Promise<MessageIntent> {
  const trimmed = text.trim();

  // Regex fast-path: structural commands never need the LLM.
  const cmd = parseGraphEditCommand(trimmed);
  if (cmd) return { kind: "graph_edit", command: cmd };

  // Combined team + product work → execute pipeline (design graph during run if needed).
  if (looksLikeProductDeliverable(trimmed) && looksLikePipelineTask(trimmed)) {
    return { kind: "task_run" };
  }

  // Heuristic fast-path: team/pipeline design on canvas only (before generic direct chat).
  if (isTeamStructureOnly(trimmed, agents.length)) {
    return { kind: "graph_design" };
  }

  // Heuristic fast-path: direct chat without LLM call.
  if (looksLikeGraphMetaQuestion(trimmed) || looksLikeDirectChat(trimmed)) {
    return { kind: "q_and_a" };
  }

  // LLM fallback for natural-language edits and ambiguous messages.
  const agentList =
    agents.map((a) => `${a.id} (${a.label})`).join(", ") || "none";

  try {
    const model = getModel(false);
    const reply = await model.invoke([
      new SystemMessage(CLASSIFIER_SYSTEM),
      new HumanMessage(
        `Current graph agents: ${agentList}\n\nMessage: """${trimmed}"""`
      ),
    ]);
    const raw =
      typeof reply.content === "string"
        ? reply.content
        : Array.isArray(reply.content)
          ? reply.content
              .map((c) =>
                typeof c === "string" ? c : (c as { text?: string }).text ?? ""
              )
              .join("")
          : String(reply.content ?? "");

    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      return looksLikePipelineTask(trimmed) ? { kind: "task_run" } : { kind: "q_and_a" };
    }

    const json = JSON.parse(jsonMatch[0]) as {
      intent?: string;
      confidence?: number;
      edit_description?: string;
    };
    const intent = json.intent ?? "q_and_a";
    const confidence = typeof json.confidence === "number" ? json.confidence : 0.5;
    const desc = json.edit_description ?? "";

    if (intent === "q_and_a") return { kind: "q_and_a" };

    if (intent === "graph_design") {
      if (looksLikeProductDeliverable(trimmed) && looksLikePipelineTask(trimmed)) {
        return { kind: "task_run" };
      }
      return { kind: "graph_design" };
    }

    if (intent === "graph_edit") {
      const parsedCmd = parseGraphEditCommand(desc);
      if (confidence >= 0.8 && parsedCmd !== null) {
        return { kind: "graph_edit", command: parsedCmd };
      }
      return {
        kind: "graph_edit_pending",
        description: desc,
        command: parsedCmd,
        confidence,
      };
    }

    if (intent === "task_run") {
      if (isTeamStructureOnly(trimmed, agents.length)) return { kind: "graph_design" };
      // LLM said task_run but heuristics disagree → prefer direct chat.
      if (!looksLikePipelineTask(trimmed)) return { kind: "q_and_a" };
      return { kind: "task_run" };
    }

    return { kind: "q_and_a" };
  } catch {
    return looksLikePipelineTask(trimmed) ? { kind: "task_run" } : { kind: "q_and_a" };
  }
}

export { looksLikePipelineTask, looksLikeGraphDesignRequest, shouldExecutePipeline } from "./pipeline-gate.js";
