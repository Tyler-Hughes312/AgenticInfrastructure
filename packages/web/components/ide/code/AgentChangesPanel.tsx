"use client";

import type { WorkspaceFileChangeSummary } from "../../../app/api-client";

type AgentChangesPanelProps = {
  changes: WorkspaceFileChangeSummary[];
  onOpenDiff: (change: WorkspaceFileChangeSummary) => void;
  onOpenFile: (path: string) => void;
};

export default function AgentChangesPanel({
  changes,
  onOpenDiff,
  onOpenFile,
}: AgentChangesPanelProps) {
  if (!changes.length) {
    return (
      <p className="text-xs text-charcoal-muted p-3">
        No agent file changes recorded yet.
      </p>
    );
  }

  return (
    <div className="divide-y divide-charcoal-border">
      {changes.map((change) => (
        <div key={change.id} className="p-3 hover:bg-charcoal-raised/40">
          <div className="flex items-start justify-between gap-2 mb-1">
            <button
              type="button"
              onClick={() => onOpenFile(change.path)}
              className="text-xs font-mono text-charcoal-text hover:text-charcoal-accent truncate text-left"
              title={change.path}
            >
              {change.path}
            </button>
            <span className="text-[10px] uppercase tracking-wide text-charcoal-muted shrink-0">
              {change.action}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-charcoal-muted">
              {change.agent_id}
              {change.created_at
                ? ` · ${new Date(change.created_at).toLocaleTimeString()}`
                : ""}
            </span>
            <button
              type="button"
              onClick={() => onOpenDiff(change)}
              className="text-[11px] text-charcoal-accent hover:underline shrink-0"
            >
              View diff
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
