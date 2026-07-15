"use client";

import { Suspense, useState, type ReactNode } from "react";
import ActivityBar from "./ActivityBar";
import OrchestratorChat from "./OrchestratorChat";
import { useIdeShell } from "../../hooks/useIdeShell";
import { CHAT_OPEN_KEY, setChatPanelOpen, DEFAULT_CHAT_WIDTH } from "../../lib/ide-chat-panel";

function SecondaryChatDrawer() {
  const [open, setOpen] = useState(false);
  const {
    agentIds,
    sessionId,
    messages,
    setMessages,
    session,
    handleSend,
  } = useIdeShell();

  if (!sessionId) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-0 top-1/2 -translate-y-1/2 z-40 flex items-center gap-1 px-2 py-3 rounded-l-lg bg-charcoal-surface border border-r-0 border-charcoal-border text-charcoal-muted hover:bg-charcoal-raised hover:text-charcoal-text shadow-lg"
        aria-label="Open orchestrator chat"
      >
        <span className="text-xs font-medium">Chat</span>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close chat overlay"
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <div
            className="fixed right-0 top-0 bottom-0 z-50 border-l border-charcoal-border bg-charcoal-bg shadow-2xl"
            style={{ width: DEFAULT_CHAT_WIDTH }}
          >
            <div className="h-full flex flex-col">
              <div className="shrink-0 flex justify-end p-2 border-b border-charcoal-border">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setChatPanelOpen(false);
                  }}
                  className="text-xs text-charcoal-muted hover:text-charcoal-text px-2 py-1"
                >
                  Close
                </button>
              </div>
              <div className="flex-1 min-h-0">
                <OrchestratorChat
                  agentIds={agentIds}
                  events={session.events}
                  shownState={session.shownState}
                  status={session.status}
                  error={session.error}
                  actualRunId={session.actualRunId}
                  isRunning={session.isRunning}
                  initialMessages={messages}
                  onMessagesChange={setMessages}
                  sessionId={sessionId}
                  onSend={handleSend}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default function SecondaryPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-charcoal-bg text-charcoal-text">
      <ActivityBar />
      <div className="flex-1 min-w-0 h-full overflow-y-auto">{children}</div>
      <Suspense fallback={null}>
        <SecondaryChatDrawer />
      </Suspense>
    </div>
  );
}
