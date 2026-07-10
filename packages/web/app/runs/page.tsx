"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  deleteChatSession,
  deleteRun,
  deleteSavedGraphTemplate,
  duplicateChatSession,
  fetchChatSessions,
  fetchProjects,
  fetchRuns,
  fetchSavedGraphTemplates,
  openSavedGraphTemplate,
  updateChatSessionTitle,
  type ChatSessionSummary,
  type ProjectSummary,
  type SavedGraphTemplateSummary,
} from "../api-client";
import SecondaryPageShell from "../../components/ide/SecondaryPageShell";

type RunRow = {
  id: string;
  project_id: string;
  chat_session_id: string | null;
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
    normalized === "running" || normalized === "pending"
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

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

export default function RunsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [structures, setStructures] = useState<ChatSessionSummary[]>([]);
  const [templates, setTemplates] = useState<SavedGraphTemplateSummary[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [graphProjectPick, setGraphProjectPick] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const [p, s, t, r] = await Promise.all([
        fetchProjects(),
        fetchChatSessions(),
        fetchSavedGraphTemplates(),
        fetchRuns(),
      ]);
      setProjects(p);
      setStructures(s);
      setTemplates(t);
      setRuns(r);
      setGraphProjectPick((prev) => {
        const next = { ...prev };
        for (const tpl of t) {
          if (!next[tpl.id] && p[0]) next[tpl.id] = p[0].id;
        }
        return next;
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [load]);

  async function handleOpenTemplate(templateId: string) {
    const projectId = graphProjectPick[templateId];
    if (!projectId) {
      setError("Select a project for this graph first.");
      return;
    }
    setBusy(`tpl-${templateId}`);
    try {
      const opened = await openSavedGraphTemplate(templateId, projectId);
      router.push(
        `/?project=${encodeURIComponent(opened.project_id)}&session=${encodeURIComponent(opened.session_id)}`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open graph");
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveTitle(sessionId: string) {
    const title = editTitle.trim();
    if (!title) return;
    setBusy(sessionId);
    try {
      await updateChatSessionTitle(sessionId, title);
      setEditingId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save title");
    } finally {
      setBusy(null);
    }
  }

  async function handleDuplicate(sessionId: string) {
    setBusy(`dup-${sessionId}`);
    try {
      const copy = await duplicateChatSession(sessionId);
      router.push(`/?session=${copy.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to duplicate");
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteTemplate(templateId: string, name: string) {
    if (!confirm(`Delete saved infrastructure "${name}"?`)) return;
    setBusy(`del-t-${templateId}`);
    try {
      await deleteSavedGraphTemplate(templateId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete template");
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteStructure(sessionId: string) {
    if (!confirm("Delete this saved structure? Chat history and graph will be removed.")) return;
    setBusy(`del-s-${sessionId}`);
    try {
      await deleteChatSession(sessionId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete structure");
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteRun(runId: string) {
    if (!confirm("Delete this run record?")) return;
    setBusy(`del-r-${runId}`);
    try {
      await deleteRun(runId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete run");
    } finally {
      setBusy(null);
    }
  }

  return (
    <SecondaryPageShell>
      <main className="p-6 md:p-10">
        <div className="max-w-5xl mx-auto w-full space-y-10">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-charcoal-text tracking-tight">
                Projects, graphs & runs
              </h1>
              <p className="text-sm text-charcoal-muted mt-1 max-w-xl">
                Projects are repo workspaces. Graphs are saved agent blueprints. Sessions are live
                chats on a project. Runs are task history.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/projects"
                className="inline-flex items-center px-3.5 py-2 text-sm font-medium rounded-lg bg-charcoal-accent text-white hover:brightness-110 transition-colors"
              >
                New project
              </Link>
              <Link
                href="/"
                className="inline-flex items-center px-3.5 py-2 text-sm font-medium rounded-lg bg-charcoal-raised border border-charcoal-border text-charcoal-text hover:bg-charcoal-border/40 transition-colors"
              >
                Workspace
              </Link>
            </div>
          </header>

          {error && (
            <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <section>
            <h2 className="text-sm font-semibold text-charcoal-text mb-3">Projects</h2>
            <p className="text-xs text-charcoal-muted mb-3">
              Repo-backed workspaces. Open a project to start a session agents can edit.
            </p>
            <div className="bg-charcoal-surface rounded-xl border border-charcoal-border overflow-hidden mb-10">
              <table className="w-full text-sm text-left">
                <thead className="bg-charcoal-raised/80 text-charcoal-muted">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Name</th>
                    <th className="px-4 py-2.5 font-medium">Repo</th>
                    <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => (
                    <tr
                      key={p.id}
                      className="border-t border-charcoal-border hover:bg-charcoal-raised/40 transition-colors"
                    >
                      <td className="px-4 py-2.5 text-charcoal-text">{p.name}</td>
                      <td className="px-4 py-2.5 text-charcoal-muted">
                        {p.source_type === "local"
                          ? "Local"
                          : p.repo_url.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "")}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Link
                          href="/projects"
                          className="text-xs font-medium text-charcoal-accent hover:underline"
                        >
                          Manage
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {!projects.length && (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-charcoal-muted">
                        No projects yet.{" "}
                        <Link href="/projects" className="text-charcoal-accent hover:underline">
                          Create one
                        </Link>
                        .
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-charcoal-text mb-3">Graphs (blueprints)</h2>
            <p className="text-xs text-charcoal-muted mb-3">
              Reusable agent teams you explicitly saved. Pick a project, then open the graph on it.
            </p>
            <div className="bg-charcoal-surface rounded-xl border border-charcoal-border overflow-hidden mb-10">
              <table className="w-full text-sm text-left">
                <thead className="bg-charcoal-raised/80 text-charcoal-muted">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Name</th>
                    <th className="px-4 py-2.5 font-medium">Agents</th>
                    <th className="px-4 py-2.5 font-medium">Saved</th>
                    <th className="px-4 py-2.5 font-medium">Project</th>
                    <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((t) => (
                    <tr
                      key={t.id}
                      className="border-t border-charcoal-border hover:bg-charcoal-raised/40 transition-colors"
                    >
                      <td className="px-4 py-2.5">
                        <div className="text-charcoal-text">{t.name}</div>
                        {t.description && (
                          <div className="text-xs text-charcoal-muted mt-0.5">{t.description}</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-charcoal-muted">{t.agent_count}</td>
                      <td className="px-4 py-2.5 text-charcoal-muted whitespace-nowrap">
                        {formatDate(t.updated_at)}
                      </td>
                      <td className="px-4 py-2.5">
                        <select
                          className="bg-charcoal-bg border border-charcoal-border rounded px-2 py-1 text-xs text-charcoal-text max-w-[10rem]"
                          value={graphProjectPick[t.id] ?? ""}
                          onChange={(e) =>
                            setGraphProjectPick((prev) => ({ ...prev, [t.id]: e.target.value }))
                          }
                        >
                          <option value="">Select…</option>
                          {projects.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => void handleOpenTemplate(t.id)}
                            disabled={busy === `tpl-${t.id}`}
                            className="text-xs font-medium text-charcoal-accent hover:underline disabled:opacity-50"
                          >
                            Open on project
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteTemplate(t.id, t.name)}
                            disabled={busy === `del-t-${t.id}`}
                            className="text-xs font-medium text-red-400 hover:text-red-300 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!templates.length && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-charcoal-muted">
                        No saved graphs yet. On the workspace graph tab, use Save infrastructure.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-charcoal-text mb-3">Sessions</h2>
            <div className="bg-charcoal-surface rounded-xl border border-charcoal-border overflow-hidden">
              <table className="w-full text-sm text-left">
                <thead className="bg-charcoal-raised/80 text-charcoal-muted">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Name</th>
                    <th className="px-4 py-2.5 font-medium">Agents</th>
                    <th className="px-4 py-2.5 font-medium">Messages</th>
                    <th className="px-4 py-2.5 font-medium">Updated</th>
                    <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {structures.map((s) => (
                    <tr
                      key={s.id}
                      className="border-t border-charcoal-border hover:bg-charcoal-raised/40 transition-colors"
                    >
                      <td className="px-4 py-2.5 max-w-xs">
                        {editingId === s.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              className="flex-1 min-w-0 bg-charcoal-bg border border-charcoal-border rounded px-2 py-1 text-sm text-charcoal-text"
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void handleSaveTitle(s.id);
                                if (e.key === "Escape") setEditingId(null);
                              }}
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={() => void handleSaveTitle(s.id)}
                              disabled={busy === s.id}
                              className="text-xs text-charcoal-accent hover:underline shrink-0"
                            >
                              Save
                            </button>
                          </div>
                        ) : (
                          <span className="text-charcoal-text truncate block">
                            {s.title?.trim() || "Untitled structure"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-charcoal-muted">{s.agent_count}</td>
                      <td className="px-4 py-2.5 text-charcoal-muted">{s.message_count}</td>
                      <td className="px-4 py-2.5 text-charcoal-muted whitespace-nowrap">
                        {formatDate(s.updated_at)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-2 flex-wrap">
                          <Link
                            href={
                              s.project_id
                                ? `/?project=${s.project_id}&session=${s.id}`
                                : `/?session=${s.id}`
                            }
                            className="text-xs font-medium text-charcoal-accent hover:underline"
                          >
                            Open
                          </Link>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(s.id);
                              setEditTitle(s.title?.trim() || "");
                            }}
                            className="text-xs font-medium text-charcoal-muted hover:text-charcoal-text"
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDuplicate(s.id)}
                            disabled={busy === `dup-${s.id}`}
                            className="text-xs font-medium text-charcoal-muted hover:text-charcoal-text disabled:opacity-50"
                          >
                            Build upon
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteStructure(s.id)}
                            disabled={busy === `del-s-${s.id}`}
                            className="text-xs font-medium text-red-400 hover:text-red-300 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!structures.length && (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-charcoal-muted">
                        No saved structures yet. Start in the{" "}
                        <Link href="/" className="text-charcoal-accent hover:underline">
                          workspace
                        </Link>{" "}
                        — your graph and chat auto-save to a session.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-charcoal-text mb-3">Run history</h2>
            <div className="bg-charcoal-surface rounded-xl border border-charcoal-border overflow-hidden">
              <table className="w-full text-sm text-left">
                <thead className="bg-charcoal-raised/80 text-charcoal-muted">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Task</th>
                    <th className="px-4 py-2.5 font-medium">Started</th>
                    <th className="px-4 py-2.5 font-medium">Trace</th>
                    <th className="px-4 py-2.5 font-medium">PR</th>
                    <th className="px-4 py-2.5 font-medium text-right">Actions</th>
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
                        {formatDate(r.started_at)}
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
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-2">
                          {r.chat_session_id ? (
                            <Link
                              href={`/?session=${r.chat_session_id}`}
                              className="text-xs font-medium text-charcoal-accent hover:underline"
                            >
                              Open session
                            </Link>
                          ) : (
                            <Link
                              href={`/?runId=${r.id}`}
                              className="text-xs font-medium text-charcoal-muted hover:text-charcoal-text"
                            >
                              View run
                            </Link>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleDeleteRun(r.id)}
                            disabled={busy === `del-r-${r.id}`}
                            className="text-xs font-medium text-red-400 hover:text-red-300 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!runs.length && (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-charcoal-muted">
                        No runs yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </main>
    </SecondaryPageShell>
  );
}
