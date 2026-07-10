"use client";

import { Suspense } from "react";
import IdeLayout from "./IdeLayout";
import OrchestratorChat from "./OrchestratorChat";
import CodeIdeShell from "./code/CodeIdeShell";
import { useRunSessionContext } from "../run/RunSessionProvider";
import { useOrchestrator } from "../orchestrator/OrchestratorProvider";
import { useChatSession } from "../chat/ChatSessionProvider";
import { parseOrchestratorMessage } from "../../lib/parse-chat-launch";

function CodePageContent() {
  const { config, agentIds } = useOrchestrator();
  const { sessionId, projectId, messages, startNewSession, setMessages } = useChatSession();
  const session = useRunSessionContext();

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
      main={<CodeIdeShell runStatus={session.status} runId={session.actualRunId} />}
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

export default function CodePageShell() {
  return (
    <Suspense
      fallback={
        <div className="h-screen bg-charcoal-bg text-charcoal-muted flex items-center justify-center">
          Loading code IDE...
        </div>
      }
    >
      <CodePageContent />
    </Suspense>
  );
}
