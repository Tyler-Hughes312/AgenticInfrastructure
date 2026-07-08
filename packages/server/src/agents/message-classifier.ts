import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getModel } from "../models-llm.js";
import { parseGraphEditCommand, type GraphEditCommand } from "./graph-edit.js";
import type { CustomAgentConfig } from "./agent-registry.js";

export type MessageIntent =
  | { kind: "graph_edit"; command: GraphEditCommand }
  | { kind: "graph_edit_pending"; description: string; command: GraphEditCommand | null; confidence: number }
  | { kind: "task_run" }
  | { kind: "q_and_a" };

const CLASSIFIER_SYSTEM = `You classify orchestrator chat messages into one of three intents.
Return JSON only — no prose, no markdown fences:
{ "intent": "graph_edit" | "task_run" | "q_and_a", "confidence": <0.0-1.0>, "edit_description": "<string>" }

Definitions:
- graph_edit: structural canvas changes — add/remove/connect/disconnect/rename/rebuild agents or edges
- task_run: a task to execute with agents (coding, research, writing, analysis, build, etc.)
- q_and_a: a short question needing no work and no graph change

edit_description: plain English summary of the edit if intent is graph_edit, e.g.
  "connect researcher → essay_writer and remove publisher"
  Leave empty string for task_run and q_and_a.`;

export async function classifyMessageIntent(
  text: string,
  agents: CustomAgentConfig[]
): Promise<MessageIntent> {
  // Regex fast-path: high-confidence structural commands never need the LLM.
  const cmd = parseGraphEditCommand(text);
  if (cmd) return { kind: "graph_edit", command: cmd };

  // LLM fallback for natural-language edits and ambiguous messages.
  const agentList =
    agents.map((a) => `${a.id} (${a.label})`).join(", ") || "none";

  try {
    const model = getModel(false);
    const reply = await model.invoke([
      new SystemMessage(CLASSIFIER_SYSTEM),
      new HumanMessage(
        `Current graph agents: ${agentList}\n\nMessage: """${text}"""`
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
    if (!jsonMatch) return { kind: "task_run" };

    const json = JSON.parse(jsonMatch[0]) as {
      intent?: string;
      confidence?: number;
      edit_description?: string;
    };
    const intent = json.intent ?? "task_run";
    const confidence = typeof json.confidence === "number" ? json.confidence : 0.5;
    const desc = json.edit_description ?? "";

    if (intent === "q_and_a") return { kind: "q_and_a" };

    if (intent === "graph_edit") {
      // Try to parse the description into a structured command.
      const parsedCmd = parseGraphEditCommand(desc);
      if (confidence >= 0.8 && parsedCmd !== null) {
        return { kind: "graph_edit", command: parsedCmd };
      }
      return {
        kind: "graph_edit_pending",
        description: desc,
        command: parsedCmd, // non-null if description was parseable, null otherwise
        confidence,
      };
    }

    return { kind: "task_run" };
  } catch {
    // Network/parse/credential error → safe fallback to treat as task_run.
    return { kind: "task_run" };
  }
}
