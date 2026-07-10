"use client";

import { Suspense } from "react";
import IdeLayout from "../../components/ide/IdeLayout";
import SettingsPanel from "../../components/ide/SettingsPanel";
import OrchestratorChat from "../../components/ide/OrchestratorChat";
import { useRunSessionContext } from "../../components/run/RunSessionProvider";
import { useOrchestrator } from "../../components/orchestrator/OrchestratorProvider";
import { useChatSession } from "../../components/chat/ChatSessionProvider";
import { parseOrchestratorMessage } from "../../lib/parse-chat-launch";

function SettingsPageContent() {
  const session = useRunSessionContext();
  const { config, agentIds } = useOrchestrator();
  const { sessionId, projectId, messages, startNewSession, setMessages } = useChatSession();

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
      main={<SettingsPanel />}
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

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen bg-charcoal-bg text-charcoal-muted flex items-center justify-center">
          Loading settings...
        </div>
      }
    >
      <SettingsPageContent />
    </Suspense>
  );
}
