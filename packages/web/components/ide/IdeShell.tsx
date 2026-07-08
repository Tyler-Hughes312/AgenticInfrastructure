"use client";

import { Suspense, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import IdeLayout from "./IdeLayout";
import ObservabilityTabs from "./ObservabilityTabs";
import OrchestratorChat from "./OrchestratorChat";
import { useRunSession } from "../../hooks/useRunSession";
import { useOrchestrator } from "../orchestrator/OrchestratorProvider";
import { parseOrchestratorMessage } from "../../lib/parse-chat-launch";

function IdeShellContent() {
  const searchParams = useSearchParams();
  const runIdParam = searchParams.get("runId");
  const questionParam = searchParams.get("question");
  const autoStartedRef = useRef(false);
  const { config, agentIds, applyRemoteConfig, resetToDefault } = useOrchestrator();

  const session = useRunSession(runIdParam);

  useEffect(() => {
    if (!questionParam || autoStartedRef.current || session.hasStarted) return;
    autoStartedRef.current = true;
    const parsed = parseOrchestratorMessage(decodeURIComponent(questionParam), agentIds);
    session.startTask(parsed.task, {
      targetAgent: parsed.targetAgent,
      orchestratorConfig: config,
    });
  }, [questionParam, session.hasStarted, session.startTask, agentIds, config]);

  // When the server auto-deploys a pipeline, mirror it onto the live graph canvas.
  useEffect(() => {
    for (let i = session.events.length - 1; i >= 0; i--) {
      const e = session.events[i];
      if (e.event !== "orchestrator_graph_updated") continue;
      const next = (e.data as { config?: typeof config } | undefined)?.config;
      if (next && Array.isArray(next.agents)) {
        applyRemoteConfig(next);
      }
      break;
    }
  }, [session.events, applyRemoteConfig]);

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
      main={
        <ObservabilityTabs
          filteredEvents={session.filteredEvents}
          shownState={session.shownState}
          computedDiffs={session.computedDiffs}
          actualRunId={session.actualRunId}
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
          onSend={handleSend}
          onReset={() => {
            session.resetSession();
            void resetToDefault();
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
