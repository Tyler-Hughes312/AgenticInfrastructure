"use client";

import { useMemo, useState } from "react";
import AgentDebugPanel from "./AgentDebugPanel";
import RunDebugConsole from "./RunDebugConsole";
import GraphViewer from "../GraphViewer";
import TraceTimeline from "../TraceTimeline";
import StateInspector from "../StateInspector";
import DiffViewer from "../DiffViewer";
import CostLatencyPanel from "../CostLatencyPanel";
import ReplayControls from "../ReplayControls";
import DriftPanel from "../DriftPanel";
import StatusLog from "../StatusLog";
import SaveInfrastructureModal from "./SaveInfrastructureModal";
import LoadInfrastructureModal from "./LoadInfrastructureModal";
import { useOrchestrator } from "../orchestrator/OrchestratorProvider";
import { useChatSession } from "../chat/ChatSessionProvider";
import type { AgentMeta } from "../../lib/agent-debug";
import type { DiffItem } from "../diff";
import type { RunEvent } from "../../lib/types/run";

type TabId = "graph" | "debug" | "events" | "state" | "metrics";

const TABS: { id: TabId; label: string }[] = [
  { id: "graph", label: "Graph" },
  { id: "debug", label: "Debug" },
  { id: "events", label: "Events" },
  { id: "state", label: "State" },
  { id: "metrics", label: "Metrics" },
];

type ObservabilityTabsProps = {
  filteredEvents: RunEvent[];
  shownState: Record<string, unknown>;
  computedDiffs: DiffItem[];
  snapshotsCount: number;
  replayIndex: number;
  isLive: boolean;
  onReplayChange: (index: number) => void;
  onToggleLive: () => void;
};

const panelClass = "bg-charcoal-surface rounded-xl border border-charcoal-border p-4";

export default function ObservabilityTabs({
  filteredEvents,
  shownState,
  computedDiffs,
  snapshotsCount,
  replayIndex,
  isLive,
  onReplayChange,
  onToggleLive,
}: ObservabilityTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>("graph");
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [showSaveInfra, setShowSaveInfra] = useState(false);
  const [showLoadInfra, setShowLoadInfra] = useState(false);
  const { config } = useOrchestrator();
  const { sessionId } = useChatSession();

  const agentMetaMap = useMemo((): Record<string, AgentMeta> => {
    const map: Record<string, AgentMeta> = {
      supervisor: {
        id: "supervisor",
        label: "Supervisor",
        role: "Orchestrator that routes tasks to sub-agents from chat.",
        tools: [],
        routesTo: config.agents.map((a) => a.id),
      },
    };
    for (const agent of config.agents) {
      map[agent.id] = {
        id: agent.id,
        label: agent.label,
        role: agent.role,
        tools: agent.tools,
        routesTo: agent.routesTo,
      };
    }
    return map;
  }, [config.agents]);

  const selectedMeta = selectedAgent ? agentMetaMap[selectedAgent] : undefined;
  const workerIds = useMemo(() => config.agents.map((a) => a.id), [config.agents]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-charcoal-bg text-charcoal-text">
      <div className="flex items-center gap-1 px-3 py-1.5 bg-charcoal-surface border-b border-charcoal-border shrink-0 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? "bg-charcoal-raised text-charcoal-text font-medium"
                : "text-charcoal-muted hover:bg-charcoal-raised/60 hover:text-charcoal-text"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {activeTab === "graph" && (
          <div className="flex flex-col h-full min-h-0">
            <div
              className={`flex flex-col min-h-0 ${selectedAgent ? "flex-1" : "h-full"} bg-charcoal-bg border-b border-charcoal-border`}
            >
              <div className="px-4 pt-3 shrink-0">
                <StatusLog events={filteredEvents} />
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <p className="text-xs text-charcoal-muted">
                    {config.agents.length === 0
                      ? "Blank project canvas — the orchestrator will deploy sub-agents when you send a build task."
                      : "Click an agent node to inspect logs, tools, code, and git activity."}
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowLoadInfra(true)}
                      className="text-xs px-2.5 py-1 rounded-lg border border-charcoal-border hover:bg-charcoal-raised text-charcoal-muted hover:text-charcoal-text"
                    >
                      Load infrastructure
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowSaveInfra(true)}
                      disabled={config.agents.length === 0}
                      className="text-xs px-2.5 py-1 rounded-lg border border-charcoal-accent/50 text-charcoal-accent hover:bg-charcoal-accent/10 disabled:opacity-40"
                      title="Explicitly save this agent team as a reusable blueprint"
                    >
                      Save infrastructure
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex-1 min-h-0 px-4 pb-4">
                <GraphViewer
                  events={filteredEvents}
                  agentMetaMap={agentMetaMap}
                  selectedNodeId={selectedAgent}
                  onNodeSelect={setSelectedAgent}
                />
              </div>
            </div>
            {selectedAgent && (
              <div className="h-[42%] min-h-[220px] shrink-0">
                <AgentDebugPanel
                  agentId={selectedAgent}
                  agentMeta={selectedMeta}
                  events={filteredEvents}
                  knownAgentIds={workerIds}
                  onClose={() => setSelectedAgent(null)}
                />
              </div>
            )}
          </div>
        )}

        {activeTab === "debug" && (
          <div className="h-full min-h-0 overflow-auto p-4 space-y-4">
            <div className={`${panelClass} max-w-xl`}>
              <h3 className="text-sm font-semibold mb-3 text-charcoal-text">Replay</h3>
              <ReplayControls
                max={Math.max(0, snapshotsCount - 1)}
                value={replayIndex}
                onChange={onReplayChange}
                isLive={isLive}
                onToggleLive={onToggleLive}
              />
            </div>
            <RunDebugConsole events={filteredEvents} agentMetaMap={agentMetaMap} />
          </div>
        )}

        {activeTab === "events" && (
          <div className="overflow-auto p-4">
            <div className={panelClass}>
              <h3 className="text-sm font-semibold mb-3 text-charcoal-text">Event Timeline</h3>
              <TraceTimeline events={filteredEvents} />
            </div>
          </div>
        )}

        {activeTab === "state" && (
          <div className="overflow-auto p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className={panelClass}>
              <h3 className="text-sm font-semibold mb-3 text-charcoal-text">State Inspector</h3>
              <StateInspector state={shownState} />
            </div>
            <div className={panelClass}>
              <h3 className="text-sm font-semibold mb-3 text-charcoal-text">State Changes</h3>
              <DiffViewer diffs={computedDiffs} />
            </div>
          </div>
        )}

        {activeTab === "metrics" && (
          <div className="overflow-auto p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className={panelClass}>
              <h3 className="text-sm font-semibold mb-3 text-charcoal-text">Performance Metrics</h3>
              <CostLatencyPanel events={filteredEvents} agentIds={workerIds} />
            </div>
            <div className={panelClass}>
              <h3 className="text-sm font-semibold mb-3 text-charcoal-text">Quality Metrics</h3>
              <DriftPanel state={shownState} />
            </div>
          </div>
        )}
      </div>

      <SaveInfrastructureModal
        open={showSaveInfra}
        onClose={() => setShowSaveInfra(false)}
        sessionId={sessionId}
        config={config}
      />
      <LoadInfrastructureModal
        open={showLoadInfra}
        onClose={() => setShowLoadInfra(false)}
        applyToCurrent
      />
    </div>
  );
}
