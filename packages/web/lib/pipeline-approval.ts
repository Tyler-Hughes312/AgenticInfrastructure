import type { RunEvent } from "./types/run";

function eventText(e: RunEvent): string {
  const output = e.data?.output;
  if (typeof output === "string") return output;
  if (output && typeof output === "object") {
    const content = (output as { content?: unknown }).content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((p) =>
          typeof p === "string" ? p : p && typeof p === "object" ? String((p as { text?: string }).text ?? "") : ""
        )
        .join("");
    }
  }
  return "";
}

function nodeOf(e: RunEvent): string {
  return String(e.metadata?.langgraph_node || e.name || "").toLowerCase();
}

/** True when reviewer finished and publisher has not yet run this session. */
export function needsPublishApproval(events: RunEvent[]): boolean {
  let sawReviewer = false;
  let sawPublisher = false;
  let lastReviewerText = "";

  for (const e of events) {
    const node = nodeOf(e);
    if (node.includes("publisher") && (e.event === "on_chain_start" || e.event === "on_node_start")) {
      sawPublisher = true;
    }
    if (node.includes("reviewer") && (e.event === "on_chain_end" || e.event === "on_chat_model_end")) {
      sawReviewer = true;
      const text = eventText(e);
      if (text.trim()) lastReviewerText = text;
    }
  }

  if (!sawReviewer || sawPublisher) return false;
  const lower = lastReviewerText.toLowerCase();
  if (lower.includes("decision: request_changes") || lower.includes("request changes")) {
    return false;
  }
  // Reviewer ran; publisher hasn't — offer human approve even if DECISION line was fuzzy.
  return true;
}

export const APPROVE_AND_PUBLISH_PROMPT =
  "approve — proceed to publisher: ship the current work (commit/push/open PR if a repo is configured).";
