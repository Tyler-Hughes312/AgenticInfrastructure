"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ChatMessageBubble from "./ChatMessage";
import SupervisorRoutingPanel from "../SupervisorRoutingPanel";
import { useOrchestratorChat } from "../../hooks/useOrchestratorChat";
import { setChatPanelOpen } from "../../lib/ide-chat-panel";
import {
  APPROVE_AND_PUBLISH_PROMPT,
  needsPublishApproval,
} from "../../lib/pipeline-approval";
import { parseGraphEditCommand, previewGraphEditMessage } from "../../lib/graph-edit";
import { useOrchestrator } from "../orchestrator/OrchestratorProvider";
import type { ChatMessage } from "../../lib/types/chat";

import type { RunEvent, RunSessionStatus } from "../../lib/types/run";

type OrchestratorChatProps = {
  agentIds?: string[];
  events: RunEvent[];
  shownState: Record<string, unknown>;
  status: RunSessionStatus;
  error: string | null;
  actualRunId: string | null;
  isRunning: boolean;
  onSend: (message: string) => void;
  onReset: () => void;
};

export default function OrchestratorChat({
  agentIds = [],
  events,
  shownState,
  status,
  error,
  actualRunId,
  isRunning,
  onSend,
  onReset,
}: OrchestratorChatProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [showRouting, setShowRouting] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageIdRef = useRef(0);
  const { config } = useOrchestrator();

  const onMessagesChange = useCallback(
    (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
      setMessages(updater);
    },
    []
  );

  useOrchestratorChat({
    events,
    shownState,
    status,
    error,
    actualRunId,
    isRunning,
    onMessagesChange,
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (
      last?.role === "assistant" &&
      last.content.includes("Reply **yes**")
    ) {
      setPendingConfirmation(last.content);
    } else {
      setPendingConfirmation(null);
    }
  }, [messages]);

  function handleReset() {
    setMessages([]);
    setInput("");
    onReset();
  }

  const showApprove = useMemo(
    () =>
      !isRunning &&
      status !== "idle" &&
      agentIds.includes("publisher") &&
      needsPublishApproval(events),
    [isRunning, status, agentIds, events]
  );

  function sendText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isRunning) return;

    messageIdRef.current += 1;
    const userMsg: ChatMessage = {
      id: `user-${messageIdRef.current}`,
      role: "user",
      content: trimmed,
      ts: Date.now(),
      runId: actualRunId ?? undefined,
    };

    const edit = parseGraphEditCommand(trimmed);
    if (edit) {
      messageIdRef.current += 1;
      setMessages((prev) => [
        ...prev,
        userMsg,
        {
          id: `edit-${messageIdRef.current}`,
          role: "status",
          content: previewGraphEditMessage(config, edit),
          ts: Date.now(),
        },
      ]);
      setInput("");
      onSend(trimmed);
      return;
    }

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    onSend(trimmed);
  }

  function handleSend() {
    sendText(input);
  }

  function handleApproveAndPublish() {
    sendText(APPROVE_AND_PUBLISH_PROMPT);
  }

  const statusDot =
    status === "running"
      ? "bg-emerald-400 animate-pulse"
      : status === "error"
        ? "bg-red-400"
        : status === "completed"
          ? "bg-charcoal-accent"
          : "bg-charcoal-border";

  return (
    <div className="flex flex-col h-full w-full min-h-0 min-w-[280px] bg-charcoal-bg text-charcoal-text">
      <header className="shrink-0 px-3 py-2.5 border-b border-charcoal-border flex items-center justify-between gap-2 flex-wrap bg-charcoal-surface">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot}`} />
          <h2 className="text-sm font-semibold truncate">Orchestrator</h2>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setShowRouting((v) => !v)}
            className="text-xs text-charcoal-muted hover:text-charcoal-text px-2 py-1 rounded hover:bg-charcoal-raised"
          >
            Routing
          </button>
          <button
            type="button"
            onClick={() => setChatPanelOpen(false)}
            className="text-xs text-charcoal-muted hover:text-charcoal-text px-2 py-1 rounded hover:bg-charcoal-raised"
            title="Close chat panel"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="text-xs text-charcoal-muted hover:text-charcoal-text px-2 py-1 rounded hover:bg-charcoal-raised"
          >
            New chat
          </button>
        </div>
      </header>

      {showRouting && (
        <div className="shrink-0 border-b border-charcoal-border p-3 max-h-48 overflow-auto bg-charcoal-surface">
          <SupervisorRoutingPanel />
        </div>
      )}

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-4 space-y-1">
        {messages.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <p className="text-sm text-charcoal-muted mb-2">Chat with the orchestrator</p>
            <p className="text-xs text-charcoal-muted/70 break-words">
              Describe a task, or edit the graph:{" "}
              <code className="text-charcoal-muted">add researcher</code>,{" "}
              <code className="text-charcoal-muted">connect researcher → writer</code>,{" "}
              <code className="text-charcoal-muted">remove publisher</code>,{" "}
              <code className="text-charcoal-muted">rebuild graph for a 3-stage essay</code>.
              {agentIds.length > 1 && (
                <>
                  {" "}
                  Agents: {agentIds.filter((id) => id !== "supervisor").join(", ")}.
                </>
              )}
            </p>
          </div>
        ) : (
          messages.map((message) => <ChatMessageBubble key={message.id} message={message} />)
        )}
      </div>

      <div className="shrink-0 border-t border-charcoal-border p-3 bg-charcoal-surface space-y-2">
        {showApprove && (
          <div className="rounded-lg border border-charcoal-accent/40 bg-charcoal-accent/10 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-charcoal-muted">
              Review finished — publisher is waiting. Approve to ship (commit / push / PR).
            </p>
            <button
              type="button"
              onClick={handleApproveAndPublish}
              disabled={isRunning}
              className="px-3 py-1.5 text-xs font-semibold rounded-md bg-emerald-600 text-white hover:brightness-110 disabled:opacity-40"
            >
              Approve &amp; publish
            </button>
          </div>
        )}
        {pendingConfirmation && !isRunning && (
          <div className="rounded-lg border border-charcoal-accent/40 bg-charcoal-accent/10 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-charcoal-muted">
              Confirm graph edit?
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setPendingConfirmation(null);
                  sendText("yes");
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded-md bg-emerald-600 text-white hover:brightness-110"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingConfirmation(null);
                  sendText("cancel");
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded-md bg-charcoal-raised text-charcoal-muted hover:bg-charcoal-border"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        <textarea
          className="w-full box-border bg-charcoal-raised border border-charcoal-border rounded-xl px-3 py-2.5 text-sm text-charcoal-text placeholder:text-charcoal-muted/60 resize-none focus:outline-none focus:ring-2 focus:ring-charcoal-accent/40 focus:border-charcoal-accent/50 break-words"
          placeholder='Ask the orchestrator, or type "approve" to ship…'
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={isRunning}
        />
        <div className="flex items-center justify-between mt-2 gap-2 flex-wrap">
          <span className="text-xs text-charcoal-muted/60 shrink-0">Cmd/Ctrl + Enter</span>
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() || isRunning}
            className="px-4 py-1.5 text-sm font-medium rounded-lg bg-charcoal-accent text-white hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
