"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchWorkspaceOutputs,
  workspaceFileDownloadUrl,
  type WorkspaceOutputSummary,
} from "../../app/api-client";

type WorkspaceOutputsStripProps = {
  sessionId: string | null | undefined;
  refreshKey?: string | number;
};

export default function WorkspaceOutputsStrip({
  sessionId,
  refreshKey,
}: WorkspaceOutputsStripProps) {
  const [recent, setRecent] = useState<WorkspaceOutputSummary[]>([]);
  const [deliverables, setDeliverables] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    if (!sessionId) {
      setRecent([]);
      setDeliverables([]);
      return;
    }
    try {
      const data = await fetchWorkspaceOutputs(sessionId);
      setRecent(data.recent.slice(0, 8));
      setDeliverables(data.deliverable_files.slice(0, 12));
    } catch {
      setRecent([]);
      setDeliverables([]);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const allPaths = [
    ...recent.map((r) => r.path),
    ...deliverables.filter((p) => !recent.some((r) => r.path === p)),
  ];
  const paths = allPaths.slice(0, expanded ? 20 : 6);

  if (!sessionId || allPaths.length === 0) return null;

  return (
    <div className="rounded-lg border border-charcoal-border bg-charcoal-raised/40 px-3 py-2 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-medium text-charcoal-text">Session outputs</p>
        <div className="flex items-center gap-2">
          <Link
            href={`/code?session=${encodeURIComponent(sessionId)}`}
            className="text-xs text-charcoal-accent hover:underline"
          >
            Open Code IDE
          </Link>
          {allPaths.length > 6 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-xs text-charcoal-muted hover:text-charcoal-text"
            >
              {expanded ? "Show less" : "Show all"}
            </button>
          )}
        </div>
      </div>
      <ul className="space-y-1">
        {paths.map((path) => {
          const meta = recent.find((r) => r.path === path);
          return (
            <li key={path} className="flex items-center justify-between gap-2 text-xs min-w-0">
              <Link
                href={`/code?session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`}
                className="truncate text-charcoal-muted hover:text-charcoal-accent font-mono"
                title={path}
              >
                {path}
              </Link>
              <div className="flex items-center gap-2 shrink-0">
                {meta && (
                  <span className="text-charcoal-muted/70">
                    {meta.agent_id === "user" ? "you" : meta.agent_id}
                  </span>
                )}
                <a
                  href={workspaceFileDownloadUrl(sessionId, path)}
                  className="text-charcoal-muted hover:text-charcoal-text"
                  title="Download"
                >
                  ↓
                </a>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
