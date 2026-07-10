"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  applySavedGraphTemplate,
  deleteSavedGraphTemplate,
  fetchProjects,
  fetchSavedGraphTemplates,
  openSavedGraphTemplate,
  type ProjectSummary,
  type SavedGraphTemplateSummary,
} from "../../app/api-client";
import { useChatSession } from "../chat/ChatSessionProvider";
import { useOrchestrator } from "../orchestrator/OrchestratorProvider";

type LoadInfrastructureModalProps = {
  open: boolean;
  onClose: () => void;
  /** When true, apply to current session instead of opening a new one. */
  applyToCurrent?: boolean;
  onApplied?: () => void;
};

export default function LoadInfrastructureModal({
  open,
  onClose,
  applyToCurrent = false,
  onApplied,
}: LoadInfrastructureModalProps) {
  const router = useRouter();
  const { sessionId, projectId, openSession } = useChatSession();
  const { applyRemoteConfig } = useOrchestrator();
  const [templates, setTemplates] = useState<SavedGraphTemplateSummary[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, p] = await Promise.all([fetchSavedGraphTemplates(), fetchProjects()]);
      setTemplates(t);
      setProjects(p);
      setSelectedProjectId((prev) => prev || projectId || p[0]?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!open) return null;

  async function handleOpenOnProject(templateId: string) {
    if (!selectedProjectId) {
      setError("Pick a project first — graphs run on a project workspace.");
      return;
    }
    setBusyId(templateId);
    setError(null);
    try {
      const opened = await openSavedGraphTemplate(templateId, selectedProjectId);
      await openSession(opened.session_id);
      onApplied?.();
      onClose();
      router.push(
        `/?project=${encodeURIComponent(opened.project_id)}&session=${encodeURIComponent(opened.session_id)}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleApplyCurrent(templateId: string) {
    if (!sessionId) return;
    if (
      !window.confirm(
        "Replace the current graph with this saved blueprint? Chat history stays; the canvas will change."
      )
    ) {
      return;
    }
    setBusyId(templateId);
    setError(null);
    try {
      const applied = await applySavedGraphTemplate(templateId, sessionId);
      applyRemoteConfig(applied.config);
      onApplied?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(templateId: string, templateName: string) {
    if (!window.confirm(`Delete saved graph "${templateName}"?`)) return;
    setBusyId(`del-${templateId}`);
    try {
      await deleteSavedGraphTemplate(templateId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-xl border border-charcoal-border bg-charcoal-surface shadow-xl max-h-[80vh] flex flex-col">
        <div className="px-4 py-3 border-b border-charcoal-border shrink-0">
          <h2 className="text-sm font-semibold text-charcoal-text">Saved graphs (blueprints)</h2>
          <p className="text-xs text-charcoal-muted mt-1">
            {applyToCurrent
              ? "Apply a graph to this session, or open on a project with a new session."
              : "Open a saved agent team on a project workspace."}
          </p>
          {!applyToCurrent && (
            <label className="block mt-3 text-xs text-charcoal-muted">
              Project
              <select
                className="mt-1 w-full bg-charcoal-bg border border-charcoal-border rounded-lg px-2 py-1.5 text-sm text-charcoal-text"
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
              >
                <option value="">Select project…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-2 min-h-0">
          {loading && <p className="text-xs text-charcoal-muted">Loading…</p>}
          {error && <p className="text-xs text-red-400">{error}</p>}
          {!loading && templates.length === 0 && (
            <p className="text-xs text-charcoal-muted">
              No saved graphs yet. Use &quot;Save infrastructure&quot; on the graph tab.
            </p>
          )}
          {templates.map((t) => (
            <div
              key={t.id}
              className="rounded-lg border border-charcoal-border bg-charcoal-bg/60 p-3 space-y-2"
            >
              <div>
                <div className="text-sm font-medium text-charcoal-text">{t.name}</div>
                {t.description && (
                  <p className="text-xs text-charcoal-muted mt-0.5">{t.description}</p>
                )}
                <p className="text-xs text-charcoal-muted/70 mt-1">
                  {t.agent_count} agent{t.agent_count === 1 ? "" : "s"} ·{" "}
                  {new Date(t.updated_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => void handleOpenOnProject(t.id)}
                  className="text-xs px-2.5 py-1 rounded-lg bg-charcoal-accent text-white hover:brightness-110 disabled:opacity-40"
                >
                  {busyId === t.id ? "Opening…" : "Open on project"}
                </button>
                {applyToCurrent && sessionId && (
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => void handleApplyCurrent(t.id)}
                    className="text-xs px-2.5 py-1 rounded-lg border border-charcoal-border hover:bg-charcoal-raised disabled:opacity-40"
                  >
                    Use on this session
                  </button>
                )}
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => void handleDelete(t.id, t.name)}
                  className="text-xs px-2.5 py-1 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-40"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="px-4 py-3 border-t border-charcoal-border flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-lg border border-charcoal-border text-charcoal-muted hover:text-charcoal-text"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
