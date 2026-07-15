"use client";

import { useCallback } from "react";
import { useChatSession } from "../components/chat/ChatSessionProvider";
import { useOrchestrator } from "../components/orchestrator/OrchestratorProvider";
import { useRunSessionContext } from "../components/run/RunSessionProvider";
import { parseOrchestratorMessage } from "../lib/parse-chat-launch";

export function useIdeShell() {
  const { config, agentIds } = useOrchestrator();
  const { sessionId, projectId, messages, startNewSession, setMessages } = useChatSession();
  const session = useRunSessionContext();

  const handleSend = useCallback(
    (message: string) => {
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
    },
    [agentIds, config, projectId, session, sessionId]
  );

  const handleClearChat = useCallback(() => {
    setMessages([]);
  }, [setMessages]);

  const handleNewGraph = useCallback(async () => {
    session.resetSession();
    await startNewSession();
  }, [session, startNewSession]);

  return {
    agentIds,
    sessionId,
    messages,
    setMessages,
    session,
    handleSend,
    handleClearChat,
    handleNewGraph,
  };
}
