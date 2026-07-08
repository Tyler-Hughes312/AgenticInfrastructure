"use client";

import { Suspense } from "react";
import IdeLayout from "../../components/ide/IdeLayout";
import SettingsPanel from "../../components/ide/SettingsPanel";
import OrchestratorChat from "../../components/ide/OrchestratorChat";
import { useRunSession } from "../../hooks/useRunSession";
import { useOrchestrator } from "../../components/orchestrator/OrchestratorProvider";
import { parseOrchestratorMessage } from "../../lib/parse-chat-launch";

function SettingsPageContent() {
  const session = useRunSession(null);
  const { config, agentIds } = useOrchestrator();

  function handleSend(message: string) {
    const parsed = parseOrchestratorMessage(message, agentIds);
    const options = {
      targetAgent: parsed.targetAgent,
      orchestratorConfig: config,
    };
    if (session.hasStarted) {
      session.sendFollowUp(parsed.task, options);
    } else {
      session.startTask(parsed.task, options);
    }
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
          onSend={handleSend}
          onReset={session.resetSession}
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
