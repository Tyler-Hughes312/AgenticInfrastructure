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
import TraceDetails from "../TraceDetails";
import DriftPanel from "../DriftPanel";
import StatusLog from "../StatusLog";
import { useOrchestrator } from "../orchestrator/OrchestratorProvider";
import type { AgentMeta } from "../../lib/agent-debug";
import type { DiffItem } from "../diff";
import type { RunEvent } from "../../lib/types/run";

type TabId = "graph" | "debug" | "events" | "state" | "metrics" | "replay" | "trace";

const TABS: { id: TabId; label: string }[] = [
  { id: "graph", label: "Graph" },
  { id: "debug", label: "Debug" },
  { id: "events", label: "Events" },
  { id: "state", label: "State" },
  { id: "metrics", label: "Metrics" },
  { id: "replay", label: "Replay" },
  { id: "trace", label: "Trace" },
];

type ObservabilityTabsProps = {
  filteredEvents: RunEvent[];
  shownState: Record<string, unknown>;
  computedDiffs: DiffItem[];
  actualRunId: string | null;
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
  actualRunId,
  snapshotsCount,
  replayIndex,
  isLive,
  onReplayChange,
  onToggleLive,
}: ObservabilityTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>("graph");
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const { config } = useOrchestrator();

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
                <p className="text-xs text-charcoal-muted mb-2">
                  Click an agent node to inspect logs, tools, code, and git activity.
                </p>
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
                  onClose={() => setSelectedAgent(null)}
                />
              </div>
            )}
          </div>
        )}

        {activeTab === "debug" && (
          <div className="h-full min-h-0 overflow-auto p-4">
            <RunDebugConsole
              events={filteredEvents}
              shownState={shownState}
              actualRunId={actualRunId}
              agentMetaMap={agentMetaMap}
            />
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
              <CostLatencyPanel events={filteredEvents} />
            </div>
            <div className={panelClass}>
              <h3 className="text-sm font-semibold mb-3 text-charcoal-text">Quality Metrics</h3>
              <DriftPanel state={shownState} />
            </div>
          </div>
        )}

        {activeTab === "replay" && (
          <div className="overflow-auto p-4">
            <div className={`${panelClass} max-w-xl`}>
              <h3 className="text-sm font-semibold mb-3 text-charcoal-text">Replay Controls</h3>
              <ReplayControls
                max={Math.max(0, snapshotsCount - 1)}
                value={replayIndex}
                onChange={onReplayChange}
                isLive={isLive}
                onToggleLive={onToggleLive}
              />
            </div>
          </div>
        )}

        {activeTab === "trace" && (
          <div className="overflow-auto p-4">
            <div className={`${panelClass} max-w-2xl`}>
              <h3 className="text-sm font-semibold mb-3 text-charcoal-text">LangSmith Trace</h3>
              {actualRunId ? (
                <TraceDetails runId={actualRunId} />
              ) : (
                <p className="text-sm text-charcoal-muted">Start a task to view trace details.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
