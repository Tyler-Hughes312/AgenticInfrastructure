"use client";

import { Suspense, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import IdeLayout from "./IdeLayout";
import ObservabilityTabs from "./ObservabilityTabs";
import OrchestratorChat from "./OrchestratorChat";
import { useRunSessionContext } from "../run/RunSessionProvider";
import { useOrchestrator } from "../orchestrator/OrchestratorProvider";
import { useChatSession } from "../chat/ChatSessionProvider";
import { parseOrchestratorMessage } from "../../lib/parse-chat-launch";

function IdeShellContent() {
  const searchParams = useSearchParams();
  const questionParam = searchParams.get("question");
  const autoStartedRef = useRef(false);
  const { config, agentIds } = useOrchestrator();
  const { sessionId, projectId, messages, startNewSession, setMessages } = useChatSession();
  const session = useRunSessionContext();

  useEffect(() => {
    if (!questionParam || autoStartedRef.current || session.hasStarted) return;
    autoStartedRef.current = true;
    const parsed = parseOrchestratorMessage(decodeURIComponent(questionParam), agentIds);
    session.startTask(parsed.task, {
      targetAgent: parsed.targetAgent,
      orchestratorConfig: config.agents.length ? config : undefined,
      chatSessionId: sessionId ?? undefined,
      projectId: projectId ?? undefined,
    });
  }, [questionParam, session.hasStarted, session.startTask, agentIds, config, sessionId, projectId]);

  function handleSend(message: string) {
    const parsed = parseOrchestratorMessage(message, agentIds);
    const options = {
      targetAgent: parsed.targetAgent,
      orchestratorConfig: config,
      chatSessionId: sessionId ?? undefined,
      projectId: projectId ?? undefined,
    };
    if (session.hasStarted) {
      session.sendFollowUp(parsed.task, options);
    } else {
      session.startTask(parsed.task, options);
    }
  }

  function handleClearChat() {
    setMessages([]);
  }

  async function handleNewGraph() {
    session.resetSession();
    await startNewSession();
  }

  return (
    <IdeLayout
      main={
        <ObservabilityTabs
          filteredEvents={session.filteredEvents}
          shownState={session.shownState}
          computedDiffs={session.computedDiffs}
          snapshotsCount={session.snapshots.length}
          replayIndex={session.replayIndex}
          isLive={session.isLive}
          onReplayChange={session.setReplayIndex}
          onToggleLive={session.setIsLive}
        />
      }
      chat={
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
          onClearChat={handleClearChat}
          onNewGraph={() => {
            void handleNewGraph();
          }}
        />
      }
    />
  );
}

export default function IdeShell() {
  return (
    <Suspense
      fallback={
        <div className="h-screen bg-charcoal-bg text-charcoal-muted flex items-center justify-center">
          Loading workspace...
        </div>
      }
    >
      <IdeShellContent />
    </Suspense>
  );
}
