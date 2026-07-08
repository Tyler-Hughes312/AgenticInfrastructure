"use client";

import { useMemo } from "react";
import { AGENT_STATUS_MESSAGES, TOOL_STATUS_MESSAGES } from "../lib/agent-nodes";
import type { RunEvent } from "../lib/types/run";

export default function StatusLog({ events }: { events: RunEvent[] }) {
  const currentStatus = useMemo(() => {
    if (!events.length) return null;

    const lastEvent = events[events.length - 1];
    const nodeName = lastEvent.metadata?.langgraph_node || lastEvent.name;

    if (lastEvent.event === "on_chain_start" || lastEvent.event === "on_node_start") {
      if (nodeName && AGENT_STATUS_MESSAGES[nodeName]) {
        return AGENT_STATUS_MESSAGES[nodeName].start;
      }
      if (nodeName) {
        return `Processing in ${nodeName}...`;
      }
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
      if (lastEvent.name) {
        return `Using tool: ${lastEvent.name}...`;
      }
    } else if (lastEvent.event === "on_tool_end") {
      return "Tool finished.";
    }

    return "Processing...";
  }, [events]);

  if (!currentStatus) return null;

  return (
    <div className="mb-2">
      <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-charcoal-raised border border-charcoal-border">
        <span className="w-1.5 h-1.5 rounded-full bg-charcoal-accent animate-pulse shrink-0" />
        <span className="text-xs text-charcoal-muted">{currentStatus}</span>
      </div>
    </div>
  );
}
