"use client";

import { useState } from "react";
import { saveGraphTemplate, saveChatSessionGraph } from "../../app/api-client";
import type { OrchestratorGraphConfig } from "../../lib/types/orchestrator";

type SaveInfrastructureModalProps = {
  open: boolean;
  onClose: () => void;
  sessionId: string | null;
  config: OrchestratorGraphConfig;
  onSaved?: (templateId: string, name: string) => void;
};

export default function SaveInfrastructureModal({
  open,
  onClose,
  sessionId,
  config,
  onSaved,
}: SaveInfrastructureModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!open) return null;

  const agentCount = config.agents.length;

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required");
      return;
    }
    if (agentCount === 0) {
      setError("Add at least one agent before saving");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (sessionId) {
        await saveChatSessionGraph(sessionId, config);
      }
      const saved = await saveGraphTemplate({
        name: trimmed,
        description: description.trim() || undefined,
        sessionId: sessionId ?? undefined,
        config,
      });
      setSuccess(`Saved "${saved.name}" (${saved.agent_count} agents)`);
      onSaved?.(saved.id, saved.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    setName("");
    setDescription("");
    setError(null);
    setSuccess(null);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className="w-full max-w-md rounded-xl border border-charcoal-border bg-charcoal-surface shadow-xl"
        role="dialog"
        aria-labelledby="save-infra-title"
      >
        <div className="px-4 py-3 border-b border-charcoal-border">
          <h2 id="save-infra-title" className="text-sm font-semibold text-charcoal-text">
            Save agent infrastructure
          </h2>
          <p className="text-xs text-charcoal-muted mt-1">
            Saves the current graph ({agentCount} agent{agentCount === 1 ? "" : "s"}) as a reusable
            blueprint. Nothing is saved until you click Save below.
          </p>
        </div>

        <div className="p-4 space-y-3">
          {success ? (
            <p className="text-sm text-emerald-400">{success}</p>
          ) : (
            <>
              <label className="block text-xs text-charcoal-muted">
                Name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Full-stack dev team"
                  className="mt-1 w-full text-sm bg-charcoal-bg border border-charcoal-border rounded-lg px-3 py-2 text-charcoal-text"
                  autoFocus
                />
              </label>
              <label className="block text-xs text-charcoal-muted">
                Description (optional)
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What this team is for…"
                  rows={3}
                  className="mt-1 w-full text-sm bg-charcoal-bg border border-charcoal-border rounded-lg px-3 py-2 text-charcoal-text resize-none"
                />
              </label>
              {error && <p className="text-xs text-red-400">{error}</p>}
            </>
          )}
        </div>

        <div className="px-4 py-3 border-t border-charcoal-border flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="text-xs px-3 py-1.5 rounded-lg border border-charcoal-border text-charcoal-muted hover:text-charcoal-text"
          >
            {success ? "Close" : "Cancel"}
          </button>
          {!success && (
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || agentCount === 0}
              className="text-xs px-3 py-1.5 rounded-lg bg-charcoal-accent text-white hover:brightness-110 disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save infrastructure"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
