"use client";

import { useMemo, useState } from "react";
import {
  type AgentMeta,
  attributeEventsToAgents,
  computeAgentMetrics,
  extractFileChanges,
  extractGitActivity,
  extractToolCalls,
} from "../../lib/agent-debug";
import type { RunEvent } from "../../lib/types/run";
import AgentDebugPanel from "./AgentDebugPanel";
import CostLatencyPanel from "../CostLatencyPanel";
import TraceTimeline from "../TraceTimeline";

type RunDebugConsoleProps = {
  events: RunEvent[];
  shownState: Record<string, unknown>;
  actualRunId: string | null;
  agentMetaMap: Record<string, AgentMeta>;
};

const sectionClass = "bg-charcoal-surface rounded-2xl border border-charcoal-border p-4";

export default function RunDebugConsole({
  events,
  shownState,
  actualRunId,
  agentMetaMap,
}: RunDebugConsoleProps) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const workerIds = useMemo(
    () => Object.keys(agentMetaMap).filter((id) => id !== "supervisor"),
    [agentMetaMap]
  );
  const attributed = useMemo(
    () => attributeEventsToAgents(events, workerIds),
    [events, workerIds]
  );
  const allTools = useMemo(() => extractToolCalls(events, undefined, workerIds), [events, workerIds]);
  const allGit = useMemo(() => extractGitActivity(events, undefined, workerIds), [events, workerIds]);
  const allFiles = useMemo(() => extractFileChanges(events, undefined, workerIds), [events, workerIds]);

  const agentIds = useMemo(
    () => Object.keys(agentMetaMap).length ? Object.keys(agentMetaMap) : Object.keys(attributed),
    [agentMetaMap, attributed]
  );

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 h-full min-h-[500px] text-charcoal-text">
      <div className="xl:col-span-1 space-y-4">
        <section className={sectionClass}>
          <h3 className="text-sm font-semibold mb-3">Agents</h3>
          <div className="space-y-2">
            {agentIds.map((id) => {
              const metrics = computeAgentMetrics(events, id, workerIds);
              const meta = agentMetaMap[id];
              const isSelected = selectedAgent === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSelectedAgent(id)}
                  className={`w-full text-left p-3 rounded-xl border transition-colors ${
                    isSelected
                      ? "border-charcoal-accent bg-charcoal-accent/10"
                      : "border-charcoal-border hover:bg-charcoal-raised/60"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm capitalize">{meta?.label ?? id}</span>
                    <span className="text-xs text-charcoal-muted">{metrics.toolCalls} tools</span>
                  </div>
                  <p className="text-xs text-charcoal-muted mt-1 line-clamp-2">{meta?.role}</p>
                </button>
              );
            })}
          </div>
        </section>

        <section className={sectionClass}>
          <h3 className="text-sm font-semibold mb-3">Run metrics</h3>
          <CostLatencyPanel events={events} agentIds={workerIds} />
        </section>
      </div>

      <div className="xl:col-span-2 flex flex-col min-h-0 gap-4">
        {selectedAgent ? (
          <div className="flex-1 min-h-[320px] border border-charcoal-border rounded-2xl overflow-hidden">
            <AgentDebugPanel
              agentId={selectedAgent}
              agentMeta={agentMetaMap[selectedAgent]}
              events={events}
              knownAgentIds={workerIds}
              onClose={() => setSelectedAgent(null)}
            />
          </div>
        ) : (
          <section className={sectionClass}>
            <h3 className="text-sm font-semibold mb-2">Select an agent</h3>
            <p className="text-sm text-charcoal-muted">
              Choose an agent on the left to view its debug console, or browse aggregate activity below.
            </p>
          </section>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <section className={sectionClass}>
            <h3 className="text-sm font-semibold mb-3">All tool calls ({allTools.length})</h3>
            <ul className="text-xs space-y-1 max-h-40 overflow-auto font-mono">
              {allTools.slice(-20).map((t) => (
                <li key={t.id} className="flex justify-between gap-2 border-b border-charcoal-border py-1">
                  <span className="text-charcoal-text">{t.tool}</span>
                  <span className="text-charcoal-muted capitalize">{t.agent}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className={sectionClass}>
            <h3 className="text-sm font-semibold mb-3">Git & PR ({allGit.length})</h3>
            <ul className="text-xs space-y-2 max-h-40 overflow-auto">
              {allGit.length === 0 ? (
                <li className="text-charcoal-muted">No git activity yet</li>
              ) : (
                allGit.map((g) => (
                  <li key={g.id}>
                    <span className="font-medium text-charcoal-text">{g.summary}</span>
                    {g.url && (
                      <a href={g.url} className="text-blue-400 ml-2 hover:underline" target="_blank" rel="noreferrer">
                        link
                      </a>
                    )}
                  </li>
                ))
              )}
            </ul>
          </section>

          <section className={`${sectionClass} md:col-span-2`}>
            <h3 className="text-sm font-semibold mb-3">File changes ({allFiles.length})</h3>
            {allFiles.length === 0 ? (
              <p className="text-xs text-charcoal-muted">No file edits recorded</p>
            ) : (
              <ul className="text-xs font-mono space-y-1 max-h-32 overflow-auto">
                {allFiles.map((f) => (
                  <li key={f.id} className="text-charcoal-text">
                    {f.path ?? "file"} <span className="text-charcoal-muted">({f.agent})</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={`${sectionClass} md:col-span-2`}>
            <h3 className="text-sm font-semibold mb-3">State snapshot</h3>
            <pre className="text-xs bg-charcoal-bg p-3 rounded-lg overflow-auto max-h-40 text-charcoal-muted border border-charcoal-border">
              {JSON.stringify(shownState, null, 2)}
            </pre>
          </section>
        </div>

        <section className={sectionClass}>
          <h3 className="text-sm font-semibold mb-3">Full event stream</h3>
          <TraceTimeline events={events} />
          {actualRunId && <p className="text-xs text-charcoal-muted mt-2 font-mono">run: {actualRunId}</p>}
        </section>
      </div>
    </div>
  );
}
