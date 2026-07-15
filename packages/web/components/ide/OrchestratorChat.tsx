"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ChatMessageBubble from "./ChatMessage";
import SupervisorRoutingPanel from "../SupervisorRoutingPanel";
import { useOrchestratorChat } from "../../hooks/useOrchestratorChat";
import { setChatPanelOpen } from "../../lib/ide-chat-panel";
import { statusLabel } from "../../lib/chat-message-utils";
import {
  APPROVE_AND_PUBLISH_PROMPT,
  needsPublishApproval,
} from "../../lib/pipeline-approval";
import { parseGraphEditCommand, previewGraphEditMessage } from "../../lib/graph-edit";
import { useOrchestrator } from "../orchestrator/OrchestratorProvider";
import WorkspaceOutputsStrip from "./WorkspaceOutputsStrip";
import type { ChatMessage } from "../../lib/types/chat";
import type { RunEvent, RunSessionStatus } from "../../lib/types/run";

const QUICK_PROMPTS = [
  "Build a full software dev team",
  "Implement a todo app in TypeScript",
  "Add a QA agent to the graph",
  "Research and write a short report",
] as const;

type OrchestratorChatProps = {
  agentIds?: string[];
  events: RunEvent[];
  shownState: Record<string, unknown>;
  status: RunSessionStatus;
  error: string | null;
  actualRunId: string | null;
  isRunning: boolean;
  initialMessages?: ChatMessage[];
  onMessagesChange?: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  sessionId?: string | null;
  onSend: (message: string) => void;
  onClearChat?: () => void;
  onNewGraph?: () => void;
  onReset?: () => void;
};

export default function OrchestratorChat({
  agentIds = [],
  events,
  shownState,
  status,
  error,
  actualRunId,
  isRunning,
  initialMessages = [],
  onMessagesChange,
  sessionId,
  onSend,
  onClearChat,
  onNewGraph,
  onReset,
}: OrchestratorChatProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [showRouting, setShowRouting] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageIdRef = useRef(0);
  const { config } = useOrchestrator();

  const prevSessionRef = useRef(sessionId);
  useEffect(() => {
    if (prevSessionRef.current !== sessionId) {
      prevSessionRef.current = sessionId;
      setMessages(initialMessages);
      messageIdRef.current = initialMessages.length;
    }
  }, [sessionId, initialMessages]);

  const handleMessagesChange = useCallback(
    (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
      setMessages((prev) => {
        const next = updater(prev);
        onMessagesChange?.(next);
        return next;
      });
    },
    [onMessagesChange]
  );

  const { statusText } = useOrchestratorChat({
    events,
    shownState,
    status,
    error,
    actualRunId,
    isRunning,
    onMessagesChange: handleMessagesChange,
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isRunning, statusText]);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.role === "assistant" && last.content.includes("Reply **yes**")) {
      setPendingConfirmation(last.content);
    } else {
      setPendingConfirmation(null);
    }
  }, [messages]);

  function handleClearChat() {
    setInput("");
    setMessages([]);
    onMessagesChange?.([]);
    if (onClearChat) {
      onClearChat();
      return;
    }
    onReset?.();
  }

  function handleNewGraph() {
    if (isRunning) return;
    setInput("");
    setMessages([]);
    onMessagesChange?.([]);
    onNewGraph?.();
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
      setMessages((prev) => {
        const next = [
          ...prev,
          userMsg,
          {
            id: `edit-${messageIdRef.current}`,
            role: "status" as const,
            content: previewGraphEditMessage(config, edit),
            ts: Date.now(),
          },
        ];
        onMessagesChange?.(next);
        return next;
      });
      setInput("");
      onSend(trimmed);
      return;
    }

    setMessages((prev) => {
      const next = [...prev, userMsg];
      onMessagesChange?.(next);
      return next;
    });
    setInput("");
    onSend(trimmed);
  }

  function handleSend() {
    sendText(input);
  }

  function handleApproveAndPublish() {
    sendText(APPROVE_AND_PUBLISH_PROMPT);
  }

  const headerStatus = statusLabel(status, isRunning);
  const statusDot =
    isRunning
      ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)] animate-pulse"
      : status === "error"
        ? "bg-red-400"
        : status === "completed"
          ? "bg-charcoal-accent"
          : "bg-charcoal-border";

  return (
    <div className="flex flex-col h-full w-full min-h-0 min-w-[280px] bg-charcoal-bg text-charcoal-text">
      <header className="shrink-0 px-3 py-2.5 border-b border-charcoal-border bg-charcoal-surface/95 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot}`} />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold truncate leading-tight">Orchestrator</h2>
              <p className="text-[10px] text-charcoal-muted truncate">
                {isRunning ? statusText : headerStatus}
                {agentIds.length > 1 && ` · ${agentIds.filter((id) => id !== "supervisor").length} agents`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <HeaderBtn onClick={() => setShowRouting((v) => !v)} active={showRouting} title="Routing rules">
              Route
            </HeaderBtn>
            <HeaderBtn onClick={handleClearChat} title="Clear messages">
              Clear
            </HeaderBtn>
            <HeaderBtn onClick={handleNewGraph} disabled={isRunning} title="New session">
              New
            </HeaderBtn>
            <HeaderBtn onClick={() => setChatPanelOpen(false)} title="Close panel">
              ✕
            </HeaderBtn>
          </div>
        </div>
      </header>

      {showRouting && (
        <div className="shrink-0 border-b border-charcoal-border p-3 max-h-44 overflow-auto bg-charcoal-surface">
          <SupervisorRoutingPanel />
        </div>
      )}

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-3 scroll-smooth"
      >
        {messages.length === 0 ? (
          <div className="px-4 py-6">
            <div className="rounded-xl border border-charcoal-border/70 bg-charcoal-surface/50 p-4 mb-4">
              <p className="text-sm font-medium text-charcoal-text mb-1">What should the team build?</p>
              <p className="text-xs text-charcoal-muted leading-relaxed">
                Describe a deliverable, set up agents, or edit the graph with natural language.
              </p>
            </div>
            <p className="text-[10px] uppercase tracking-wider text-charcoal-muted/70 mb-2 px-1">
              Try asking
            </p>
            <div className="flex flex-wrap gap-2">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={isRunning}
                  onClick={() => {
                    setInput(prompt);
                    sendText(prompt);
                  }}
                  className="text-left text-xs px-3 py-2 rounded-lg border border-charcoal-border bg-charcoal-raised/50 text-charcoal-muted hover:text-charcoal-text hover:border-charcoal-accent/40 hover:bg-charcoal-raised transition-colors disabled:opacity-40"
                >
                  {prompt}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-charcoal-muted/60 mt-4 px-1 leading-relaxed">
              Graph edits:{" "}
              <code className="text-charcoal-muted">add researcher</code>,{" "}
              <code className="text-charcoal-muted">connect a → b</code>
            </p>
          </div>
        ) : (
          <div className="divide-y divide-charcoal-border/40">
            {messages.map((message) => (
              <ChatMessageBubble
                key={message.id}
                message={message}
                isLive={message.role === "status" && isRunning}
              />
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-charcoal-border bg-charcoal-surface/95 backdrop-blur-sm p-3 space-y-2.5">
        <WorkspaceOutputsStrip sessionId={sessionId} refreshKey={actualRunId ?? status} />

        {showApprove && (
          <ActionBanner
            message="Review finished — publisher is waiting. Approve to ship."
            primaryLabel="Approve & publish"
            onPrimary={handleApproveAndPublish}
            disabled={isRunning}
          />
        )}

        {pendingConfirmation && !isRunning && (
          <ActionBanner
            message="Confirm this graph edit?"
            primaryLabel="Confirm"
            secondaryLabel="Cancel"
            onPrimary={() => {
              setPendingConfirmation(null);
              sendText("yes");
            }}
            onSecondary={() => {
              setPendingConfirmation(null);
              sendText("cancel");
            }}
          />
        )}

        <div
          className={`relative rounded-xl border transition-colors ${
            isRunning
              ? "border-charcoal-border bg-charcoal-raised/30"
              : "border-charcoal-border focus-within:border-charcoal-accent/50 focus-within:ring-2 focus-within:ring-charcoal-accent/20 bg-charcoal-raised"
          }`}
        >
          <textarea
            className="w-full box-border bg-transparent rounded-xl px-3 pt-2.5 pb-10 text-sm text-charcoal-text placeholder:text-charcoal-muted/50 resize-none focus:outline-none break-words disabled:opacity-60"
            placeholder={isRunning ? "Agents are working…" : "Message the orchestrator…"}
            rows={3}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={isRunning}
          />
          <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-2.5 py-2 border-t border-charcoal-border/40">
            <span className="text-[10px] text-charcoal-muted/60">
              {isRunning ? "Pipeline running" : "Enter to send · Shift+Enter for newline"}
            </span>
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim() || isRunning}
              className="px-3 py-1 text-xs font-semibold rounded-lg bg-charcoal-accent text-white hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeaderBtn({
  children,
  onClick,
  disabled,
  active,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`text-[11px] px-2 py-1 rounded-md transition-colors disabled:opacity-40 ${
        active
          ? "bg-charcoal-accent/20 text-charcoal-accent"
          : "text-charcoal-muted hover:text-charcoal-text hover:bg-charcoal-raised"
      }`}
    >
      {children}
    </button>
  );
}

function ActionBanner({
  message,
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
  disabled,
}: {
  message: string;
  primaryLabel: string;
  secondaryLabel?: string;
  onPrimary: () => void;
  onSecondary?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-xl border border-amber-500/25 bg-amber-950/15 px-3 py-2.5 flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-charcoal-muted">{message}</p>
      <div className="flex gap-2 shrink-0">
        {secondaryLabel && onSecondary && (
          <button
            type="button"
            onClick={onSecondary}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-charcoal-raised text-charcoal-muted hover:bg-charcoal-border"
          >
            {secondaryLabel}
          </button>
        )}
        <button
          type="button"
          onClick={onPrimary}
          disabled={disabled}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:brightness-110 disabled:opacity-40"
        >
          {primaryLabel}
        </button>
      </div>
    </div>
  );
}
