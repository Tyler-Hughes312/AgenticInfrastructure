"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  type AgentMeta,
  attributeEventsToAgents,
  computeAgentMetrics,
  extractFileChanges,
  extractGitActivity,
  extractToolCalls,
  getAgentNodeState,
} from "../../lib/agent-debug";
import type { RunEvent } from "../../lib/types/run";
import { useChatSession } from "../chat/ChatSessionProvider";

type DebugTab = "overview" | "logs" | "tools" | "code" | "git";

const TABS: { id: DebugTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "logs", label: "Logs" },
  { id: "tools", label: "Tools" },
  { id: "code", label: "Code" },
  { id: "git", label: "Git & PR" },
];

type AgentDebugPanelProps = {
  agentId: string;
  agentMeta?: AgentMeta;
  events: RunEvent[];
  knownAgentIds?: string[];
  onClose: () => void;
};

export default function AgentDebugPanel({
  agentId,
  agentMeta,
  events,
  knownAgentIds,
  onClose,
}: AgentDebugPanelProps) {
  const [tab, setTab] = useState<DebugTab>("overview");
  const { sessionId } = useChatSession();

  const agentEvents = useMemo(
    () => attributeEventsToAgents(events, knownAgentIds)[agentId] ?? [],
    [events, agentId, knownAgentIds]
  );
  const metrics = useMemo(
    () => computeAgentMetrics(events, agentId, knownAgentIds),
    [events, agentId, knownAgentIds]
  );
  const toolCalls = useMemo(
    () => extractToolCalls(events, agentId, knownAgentIds),
    [events, agentId, knownAgentIds]
  );
  const fileChanges = useMemo(
    () => extractFileChanges(events, agentId, knownAgentIds),
    [events, agentId, knownAgentIds]
  );
  const gitActivity = useMemo(
    () => extractGitActivity(events, agentId, knownAgentIds),
    [events, agentId, knownAgentIds]
  );
  const status = useMemo(
    () => getAgentNodeState(events, agentId, knownAgentIds),
    [events, agentId, knownAgentIds]
  );

  const statusColor =
    status === "running"
      ? "text-emerald-400 bg-emerald-500/15"
      : status === "done"
        ? "text-charcoal-accent bg-charcoal-accent/15"
        : "text-charcoal-muted bg-charcoal-raised";

  return (
    <div className="flex flex-col h-full border-t border-charcoal-border bg-charcoal-surface text-charcoal-text">
      <div className="flex items-center justify-between px-4 py-2 border-b border-charcoal-border shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <h3 className="font-semibold text-sm capitalize truncate">{agentMeta?.label ?? agentId}</h3>
          <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${statusColor}`}>{status}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-charcoal-muted hover:text-charcoal-text px-2 py-1 rounded hover:bg-charcoal-raised"
        >
          Close
        </button>
      </div>

      <div className="flex gap-1 px-4 py-2 border-b border-charcoal-border shrink-0 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-2.5 py-1 text-xs rounded-md whitespace-nowrap ${
              tab === t.id
                ? "bg-charcoal-raised text-charcoal-text font-medium"
                : "text-charcoal-muted hover:bg-charcoal-raised"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-4 text-sm">
        {tab === "overview" && (
          <div className="space-y-4">
            <p className="text-charcoal-muted">{agentMeta?.role ?? "Agent node"}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricCard label="Invocations" value={String(metrics.invocations)} />
              <MetricCard label="Tool calls" value={String(metrics.toolCalls)} />
              <MetricCard
                label="Avg latency"
                value={metrics.avgLatencyMs != null ? `${metrics.avgLatencyMs.toFixed(0)} ms` : "—"}
              />
              <MetricCard label="Tokens" value={String(metrics.tokens)} />
            </div>
            {agentMeta?.tools && (
              <div>
                <p className="text-xs font-semibold text-charcoal-muted mb-1">Tools</p>
                <div className="flex flex-wrap gap-1">
                  {agentMeta.tools.map((tool) => (
                    <span key={tool} className="text-xs font-mono bg-charcoal-raised px-2 py-0.5 rounded text-charcoal-text">
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {agentMeta?.routesTo && agentMeta.routesTo.length > 0 && (
              <p className="text-xs text-charcoal-muted">
                Routes to: <span className="font-mono">{agentMeta.routesTo.join(", ")}</span>
              </p>
            )}
          </div>
        )}

        {tab === "logs" && (
          <div className="space-y-1 font-mono text-xs">
            {agentEvents.length === 0 ? (
              <p className="text-charcoal-muted">No events for this agent yet.</p>
            ) : (
              agentEvents.map((e, i) => (
                <div key={i} className="py-1 border-b border-charcoal-border flex gap-2">
                  <span className="text-charcoal-muted shrink-0 w-28">{e.event}</span>
                  <span className="text-charcoal-text truncate">{e.name ?? "—"}</span>
                </div>
              ))
            )}
          </div>
        )}

        {tab === "tools" && (
          <div className="space-y-3">
            {toolCalls.length === 0 ? (
              <p className="text-charcoal-muted">No tool calls recorded.</p>
            ) : (
              toolCalls.map((t) => (
                <div key={t.id} className="border border-charcoal-border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-xs font-semibold text-charcoal-text">{t.tool}</span>
                    <span className="text-xs capitalize text-charcoal-muted">{t.status}</span>
                  </div>
                  {t.input != null && (
                    <pre className="text-xs bg-charcoal-bg p-2 rounded overflow-auto max-h-32 mb-2 text-charcoal-muted">
                      {formatJson(t.input)}
                    </pre>
                  )}
                  {t.output != null && (
                    <pre className="text-xs bg-green-950/40 p-2 rounded overflow-auto max-h-40 text-green-300">
                      {formatJson(t.output)}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {tab === "code" && (
          <div className="space-y-3">
            {fileChanges.length === 0 ? (
              <p className="text-charcoal-muted">No file reads or edits recorded.</p>
            ) : (
              fileChanges.map((f) => (
                <div key={f.id} className="border border-charcoal-border rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-charcoal-bg border-b border-charcoal-border flex items-center justify-between gap-2">
                    <span className="text-xs font-mono text-charcoal-text truncate">
                      {f.path ?? "file"}
                    </span>
                    {sessionId && f.path && (
                      <Link
                        href={`/code?session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(f.path)}`}
                        className="text-[11px] text-charcoal-accent hover:underline shrink-0"
                      >
                        Open in Code IDE
                      </Link>
                    )}
                  </div>
                  {f.content && (
                    <pre className="text-xs p-3 overflow-auto max-h-48 whitespace-pre-wrap text-charcoal-muted">
                      {formatJson(f.content)}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {tab === "git" && (
          <div className="space-y-3">
            {gitActivity.length === 0 ? (
              <p className="text-charcoal-muted">No git or PR activity recorded.</p>
            ) : (
              gitActivity.map((g) => (
                <div key={g.id} className="border border-charcoal-border rounded-lg p-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-semibold uppercase text-charcoal-muted">{g.type}</span>
                    {g.url && (
                      <a
                        href={g.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-400 hover:underline truncate"
                      >
                        Open link
                      </a>
                    )}
                  </div>
                  <p className="text-sm text-charcoal-text">{g.summary}</p>
                  {g.detail && (
                    <pre className="text-xs bg-charcoal-bg p-2 rounded mt-2 overflow-auto max-h-36 text-charcoal-muted">{g.detail}</pre>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-charcoal-bg rounded-lg p-3 border border-charcoal-border">
      <p className="text-xs text-charcoal-muted">{label}</p>
      <p className="text-lg font-semibold text-charcoal-text">{value}</p>
    </div>
  );
}

function formatJson(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
