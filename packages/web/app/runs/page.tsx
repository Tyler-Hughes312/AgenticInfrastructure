"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchRuns } from "../api-client";
import SecondaryPageShell from "../../components/ide/SecondaryPageShell";

type RunRow = {
  id: string;
  project_id: string;
  status: string;
  task: string;
  started_at: string;
  completed_at: string | null;
  langfuse_trace_url: string | null;
  github_pr_url: string | null;
  error: string | null;
};

function StatusChip({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const styles =
    normalized === "running" || normalized === "in_progress"
      ? "bg-charcoal-accent/15 text-charcoal-accent border-charcoal-accent/30"
      : normalized === "completed" || normalized === "success" || normalized === "succeeded"
        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
        : normalized === "error" || normalized === "failed"
          ? "bg-red-500/15 text-red-400 border-red-500/30"
          : "bg-charcoal-raised text-charcoal-muted border-charcoal-border";

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border capitalize ${styles}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

export default function RunsPage() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      fetchRuns()
        .then(setRuns)
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <SecondaryPageShell>
      <main className="p-6 md:p-10">
        <div className="max-w-5xl mx-auto w-full">
          <header className="flex flex-wrap items-start justify-between gap-4 mb-6">
            <div>
              <h1 className="text-xl font-semibold text-charcoal-text tracking-tight">Runs</h1>
              <p className="text-sm text-charcoal-muted mt-1">
                Recent orchestrator sessions and their outcomes.
              </p>
            </div>
            <Link
              href="/"
              className="inline-flex items-center px-3.5 py-2 text-sm font-medium rounded-lg bg-charcoal-accent text-white hover:brightness-110 transition-colors"
            >
              New run
            </Link>
          </header>

          {error && (
            <p className="text-red-400 mb-4 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="bg-charcoal-surface rounded-xl border border-charcoal-border overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-charcoal-raised/80 text-charcoal-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Task</th>
                  <th className="px-4 py-2.5 font-medium">Started</th>
                  <th className="px-4 py-2.5 font-medium">Trace</th>
                  <th className="px-4 py-2.5 font-medium">PR</th>
                  <th className="px-4 py-2.5 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-charcoal-border hover:bg-charcoal-raised/40 transition-colors"
                  >
                    <td className="px-4 py-2.5">
                      <StatusChip status={r.status} />
                    </td>
                    <td className="px-4 py-2.5 max-w-xs truncate text-charcoal-text">{r.task}</td>
                    <td className="px-4 py-2.5 text-charcoal-muted whitespace-nowrap">
                      {new Date(r.started_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.langfuse_trace_url ? (
                        <a
                          href={r.langfuse_trace_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-charcoal-accent hover:underline"
                        >
                          Trace
                        </a>
                      ) : (
                        <span className="text-charcoal-muted/50">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.github_pr_url ? (
                        <a
                          href={r.github_pr_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-charcoal-accent hover:underline"
                        >
                          PR
                        </a>
                      ) : (
                        <span className="text-charcoal-muted/50">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link
                        href={`/?runId=${r.id}`}
                        className="text-charcoal-muted hover:text-charcoal-text text-xs font-medium"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
                {!runs.length && !error && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center">
                      <p className="text-charcoal-muted mb-3">No runs yet.</p>
                      <Link
                        href="/"
                        className="inline-flex items-center px-3.5 py-2 text-sm font-medium rounded-lg bg-charcoal-raised border border-charcoal-border text-charcoal-text hover:bg-charcoal-border/40 transition-colors"
                      >
                        Start from workspace
                      </Link>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </SecondaryPageShell>
  );
}
