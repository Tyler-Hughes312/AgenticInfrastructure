"use client";

import { useEffect, useMemo, useRef } from "react";
import { AGENT_STATUS_MESSAGES, TOOL_STATUS_MESSAGES } from "../lib/agent-nodes";
import type { ChatMessage } from "../lib/types/chat";
import type { RunEvent, RunSessionStatus } from "../lib/types/run";

function deriveStatusText(events: RunEvent[]): string {
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

function contentToText(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const p = part as { text?: string; content?: string; type?: string };
          if (typeof p.text === "string") return p.text;
          if (typeof p.content === "string") return p.content;
        }
        return "";
      })
      .filter(Boolean)
      .join("")
      .trim();
  }
  if (typeof content === "object") {
    const o = content as { content?: unknown; text?: unknown };
    if (o.content != null) return contentToText(o.content);
    if (typeof o.text === "string") return o.text.trim();
  }
  return "";
}

/** Pull the latest readable assistant text from LangGraph stream events. */
export function extractAssistantTextFromEvents(events: RunEvent[]): string | null {
  let last: string | null = null;

  for (const e of events) {
    if (e.event === "on_chat_model_end") {
      const output = e.data?.output;
      const text = contentToText(output?.content ?? output);
      // Skip empty / pure tool-call turns
      if (text && !looksLikeToolOnly(output)) last = text;
    }

    if (e.event === "on_chain_end" && e.data?.output) {
      const out = e.data.output;
      if (typeof out === "object" && out !== null) {
        const messages = (out as { messages?: unknown }).messages;
        if (Array.isArray(messages) && messages.length) {
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i] as { type?: string; role?: string; content?: unknown; id?: string[] };
            const type = String(msg?.type ?? msg?.role ?? "").toLowerCase();
            const isAi =
              type.includes("ai") ||
              type === "assistant" ||
              (Array.isArray(msg?.id) && msg.id.some((x) => String(x).includes("AIMessage")));
            if (!isAi) continue;
            const text = contentToText(msg.content);
            if (text) {
              last = text;
              break;
            }
          }
        }
        const final = (out as { final?: unknown; draft?: unknown }).final ?? (out as { draft?: unknown }).draft;
        if (typeof final === "string" && final.trim()) last = final.trim();
      }
    }
  }

  return last;
}

function looksLikeToolOnly(output: unknown): boolean {
  if (!output || typeof output !== "object") return false;
  const o = output as { tool_calls?: unknown[]; content?: unknown };
  const hasTools = Array.isArray(o.tool_calls) && o.tool_calls.length > 0;
  const text = contentToText(o.content);
  return hasTools && !text;
}

function extractAnswerFromState(state: Record<string, unknown>): string | null {
  const final = state.final ?? state.draft;
  if (typeof final === "string" && final.trim()) return final.trim();

  const messages = state.messages;
  if (Array.isArray(messages) && messages.length) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i] as { type?: string; role?: string; content?: unknown };
      const type = String(msg?.type ?? msg?.role ?? "").toLowerCase();
      if (type.includes("ai") || type === "assistant") {
        const text = contentToText(msg.content);
        if (text) return text;
      }
    }
  }
  return null;
}

type UseOrchestratorChatOptions = {
  events: RunEvent[];
  shownState: Record<string, unknown>;
  status: RunSessionStatus;
  error: string | null;
  actualRunId: string | null;
  isRunning: boolean;
  onMessagesChange: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void;
};

export function useOrchestratorChat({
  events,
  shownState,
  status,
  error,
  actualRunId,
  isRunning,
  onMessagesChange,
}: UseOrchestratorChatOptions) {
  const statusText = useMemo(() => deriveStatusText(events), [events]);
  const eventAnswer = useMemo(() => extractAssistantTextFromEvents(events), [events]);
  const stateAnswer = useMemo(() => extractAnswerFromState(shownState), [shownState]);
  const currentAnswer = eventAnswer ?? stateAnswer;

  const lastEmittedAnswerRef = useRef<string | null>(null);
  const lastErrorRef = useRef<string | null>(null);
  const wasRunningRef = useRef(false);

  useEffect(() => {
    if (!isRunning) {
      if (wasRunningRef.current) {
        onMessagesChange((prev) => prev.filter((m) => m.role !== "status"));
      }
      wasRunningRef.current = false;
      return;
    }

    // New turn started — allow the next assistant reply to emit even if text matches prior turn.
    if (!wasRunningRef.current) {
      lastEmittedAnswerRef.current = null;
    }
    wasRunningRef.current = true;
    onMessagesChange((prev) => {
      const withoutStatus = prev.filter((m) => m.role !== "status");
      return [
        ...withoutStatus,
        {
          id: "status-live",
          role: "status",
          content: statusText,
          ts: Date.now(),
          runId: actualRunId ?? undefined,
        },
      ];
    });
  }, [isRunning, statusText, actualRunId, onMessagesChange]);

  // Emit assistant reply when the turn finishes (or when we already have text and left running).
  useEffect(() => {
    if (isRunning) return;
    if (!currentAnswer) return;
    if (currentAnswer === lastEmittedAnswerRef.current) return;
    if (status !== "completed" && status !== "idle" && status !== "error") return;

    lastEmittedAnswerRef.current = currentAnswer;
    onMessagesChange((prev) => {
      const withoutStatus = prev.filter((m) => m.role !== "status");
      return [
        ...withoutStatus,
        {
          id: `answer-${actualRunId ?? "run"}-${Date.now()}`,
          role: "assistant",
          content: currentAnswer,
          ts: Date.now(),
          runId: actualRunId ?? undefined,
        },
      ];
    });
  }, [isRunning, currentAnswer, actualRunId, onMessagesChange, status]);

  // If a turn completes with no extractable answer, tell the user instead of going silent.
  useEffect(() => {
    if (isRunning || status !== "completed") return;
    if (currentAnswer) return;
    if (error) return;
    if (lastEmittedAnswerRef.current === "__empty__") return;

    lastEmittedAnswerRef.current = "__empty__";
    onMessagesChange((prev) => {
      const withoutStatus = prev.filter((m) => m.role !== "status");
      const already = withoutStatus.some(
        (m) => m.role === "assistant" && m.content.startsWith("Run finished")
      );
      if (already) return withoutStatus;
      return [
        ...withoutStatus,
        {
          id: `empty-${actualRunId ?? "run"}-${Date.now()}`,
          role: "assistant",
          content:
            "Run finished, but no text reply was returned. Check the Graph / Events tabs for what the agents did.",
          ts: Date.now(),
          runId: actualRunId ?? undefined,
        },
      ];
    });
  }, [isRunning, status, currentAnswer, error, actualRunId, onMessagesChange]);

  useEffect(() => {
    if (!error || error === lastErrorRef.current) return;
    lastErrorRef.current = error;
    onMessagesChange((prev) => [
      ...prev.filter((m) => m.role !== "status"),
      {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: `Error: ${error}`,
        ts: Date.now(),
        runId: actualRunId ?? undefined,
      },
    ]);
  }, [error, actualRunId, onMessagesChange]);

  return { statusText };
}
