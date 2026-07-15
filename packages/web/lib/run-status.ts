import { AGENT_STATUS_MESSAGES, TOOL_STATUS_MESSAGES } from "./agent-nodes";
import type { RunEvent } from "./types/run";

export function deriveStatusText(events: RunEvent[]): string {
  if (!events.length) return "Working...";

  const lastEvent = events[events.length - 1];
  const nodeName = (lastEvent.metadata?.langgraph_node as string | undefined) || lastEvent.name;

  if (lastEvent.event === "on_chain_start" || lastEvent.event === "on_node_start") {
    if (nodeName && AGENT_STATUS_MESSAGES[nodeName]) {
      return AGENT_STATUS_MESSAGES[nodeName].start;
    }
    if (nodeName) return `Processing in ${nodeName}...`;
  } else if (lastEvent.event === "on_chain_end" || lastEvent.event === "on_node_end") {
    if (nodeName && AGENT_STATUS_MESSAGES[nodeName]) {
      return AGENT_STATUS_MESSAGES[nodeName].end;
    }
  } else if (lastEvent.event === "on_chat_model_stream") {
    return "Generating response...";
  } else if (lastEvent.event === "on_tool_start") {
    const toolName = lastEvent.name ?? "";
    for (const [key, message] of Object.entries(TOOL_STATUS_MESSAGES)) {
      if (toolName.includes(key)) return message;
    }
    if (lastEvent.name) return `Using tool: ${lastEvent.name}...`;
  } else if (lastEvent.event === "on_tool_end") {
    return "Tool finished.";
  }

  return "Processing...";
}
