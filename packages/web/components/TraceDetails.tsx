"use client";

import { useEffect, useState } from "react";
import { apiUrl } from "../app/api-client";

export default function TraceDetails({ runId }: { runId: string }) {
  const [trace, setTrace] = useState<{
    langfuse_trace_url?: string | null;
    github_pr_url?: string | null;
    status?: string;
    error?: string;
  } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(apiUrl(`/api/trace/${runId}`));
        const data = await res.json();
        setTrace(data);
      } catch {
        setTrace(null);
      }
    }
    if (runId && runId !== "new") load();
  }, [runId]);

  if (!trace) {
    return <p className="text-sm text-charcoal-muted">Loading trace links…</p>;
  }

  return (
    <div className="text-sm space-y-2 text-charcoal-text">
      <div>Status: {trace.status ?? "unknown"}</div>
      {trace.langfuse_trace_url ? (
        <a
          href={trace.langfuse_trace_url}
          target="_blank"
          rel="noreferrer"
          className="text-blue-400 hover:underline block"
        >
          View trace in Langfuse →
        </a>
      ) : (
        <p className="text-charcoal-muted text-xs">Langfuse trace not available yet.</p>
      )}
      {trace.github_pr_url ? (
        <a
          href={trace.github_pr_url}
          target="_blank"
          rel="noreferrer"
          className="text-blue-400 hover:underline block"
        >
          View PR on GitHub →
        </a>
      ) : null}
    </div>
  );
}
