"use client";

import { useState } from "react";
import type { CustomAgentConfig } from "../../lib/types/orchestrator";

type AgentCreateModalProps = {
  open: boolean;
  availableTools: string[];
  availableModels: string[];
  existingIds: string[];
  onClose: () => void;
  onCreate: (agent: CustomAgentConfig) => void;
};

function slugifyId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "agent_$1");
}

const inputClass =
  "w-full p-2.5 rounded-lg border border-charcoal-border bg-charcoal-raised text-charcoal-text placeholder:text-charcoal-muted focus:border-charcoal-accent focus:ring-2 focus:ring-charcoal-accent/30 focus:outline-none";

export default function AgentCreateModal({
  open,
  availableTools,
  availableModels,
  existingIds,
  onClose,
  onCreate,
}: AgentCreateModalProps) {
  const [label, setLabel] = useState("");
  const [id, setId] = useState("");
  const [role, setRole] = useState("");
  const [model, setModel] = useState("");
  const [tools, setTools] = useState<string[]>(["read_file"]);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function toggleTool(tool: string) {
    setTools((prev) =>
      prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool]
    );
  }

  function handleSubmit() {
    const agentId = (id.trim() || slugifyId(label)).toLowerCase();
    if (!/^[a-z][a-z0-9_]*$/.test(agentId)) {
      setError("Agent id must be lowercase letters, numbers, and underscores.");
      return;
    }
    if (existingIds.includes(agentId)) {
      setError("An agent with this id already exists.");
      return;
    }
    if (!label.trim() || !role.trim()) {
      setError("Label and role are required.");
      return;
    }
    if (!tools.length) {
      setError("Select at least one tool.");
      return;
    }

    onCreate({
      id: agentId,
      label: label.trim(),
      role: role.trim(),
      tools,
      model: model || undefined,
      routesTo: [],
      position: { x: 200, y: 200 },
    });
    setLabel("");
    setId("");
    setRole("");
    setModel("");
    setTools(["read_file"]);
    setError(null);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-charcoal-surface rounded-2xl shadow-xl border border-charcoal-border w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 text-charcoal-text">
        <h2 className="text-lg font-semibold text-charcoal-text mb-4">Create agent</h2>

        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-charcoal-text mb-1">Label</label>
            <input
              className={inputClass}
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                if (!id) setId(slugifyId(e.target.value));
              }}
              placeholder="Code reviewer"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-charcoal-text mb-1">Id</label>
            <input
              className={`${inputClass} font-mono text-sm`}
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="code_reviewer"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-charcoal-text mb-1">Role</label>
            <textarea
              className={inputClass}
              rows={2}
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Reviews code changes for quality and security."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-charcoal-text mb-1">LLM model</label>
            <select
              className={inputClass}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {availableModels.map((m) => (
                <option key={m || "default"} value={m} className="bg-charcoal-surface">
                  {m || "Default (from settings)"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-charcoal-text mb-2">Tools</label>
            <div className="flex flex-wrap gap-2">
              {availableTools.map((tool) => (
                <button
                  key={tool}
                  type="button"
                  onClick={() => toggleTool(tool)}
                  className={`px-2.5 py-1 rounded-full text-xs font-mono border ${
                    tools.includes(tool)
                      ? "bg-charcoal-accent/15 border-charcoal-accent/40 text-charcoal-accent"
                      : "bg-charcoal-bg border-charcoal-border text-charcoal-muted"
                  }`}
                >
                  {tool}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-charcoal-border text-charcoal-text hover:bg-charcoal-raised"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="px-4 py-2 text-sm rounded-lg bg-charcoal-accent text-white hover:brightness-110"
          >
            Create agent
          </button>
        </div>
      </div>
    </div>
  );
}
