"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ChatMessageBubble from "./ChatMessage";
import SupervisorRoutingPanel from "../SupervisorRoutingPanel";
import { useOrchestratorChat } from "../../hooks/useOrchestratorChat";
import { setChatPanelOpen } from "../../lib/ide-chat-panel";
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageIdRef = useRef(0);

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

  function handleReset() {
    setMessages([]);
    setInput("");
    onReset();
  }

  function handleSend() {
    const text = input.trim();
    if (!text || isRunning) return;

    messageIdRef.current += 1;
    setMessages((prev) => [
      ...prev,
      {
        id: `user-${messageIdRef.current}`,
        role: "user",
        content: text,
        ts: Date.now(),
        runId: actualRunId ?? undefined,
      },
    ]);
    setInput("");
    onSend(text);
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
              Describe a task or launch an agent with{" "}
              <code className="text-charcoal-muted">@coder fix the bug</code> or{" "}
              <code className="text-charcoal-muted">/launch reviewer check changes</code>.
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

      <div className="shrink-0 border-t border-charcoal-border p-3 bg-charcoal-surface">
        <textarea
          className="w-full box-border bg-charcoal-raised border border-charcoal-border rounded-xl px-3 py-2.5 text-sm text-charcoal-text placeholder:text-charcoal-muted/60 resize-none focus:outline-none focus:ring-2 focus:ring-charcoal-accent/40 focus:border-charcoal-accent/50 break-words"
          placeholder="Ask the orchestrator or @agent task..."
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
