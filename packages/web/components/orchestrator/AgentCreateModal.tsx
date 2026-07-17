"use client";

import { useEffect, useMemo, useState } from "react";
import type { CustomAgentConfig, SkillDefinition } from "../../lib/types/orchestrator";
import {
  groupSkillsByCategory,
  mergeToolsFromSkills,
  suggestSkillIdsForLabelRole,
  SKILL_CATEGORY_LABELS,
} from "../../lib/skill-utils";

type AgentCreateModalProps = {
  open: boolean;
  availableTools: string[];
  availableSkills: SkillDefinition[];
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
  availableSkills,
  availableModels,
  existingIds,
  onClose,
  onCreate,
}: AgentCreateModalProps) {
  const [label, setLabel] = useState("");
  const [id, setId] = useState("");
  const [role, setRole] = useState("");
  const [model, setModel] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [tools, setTools] = useState<string[]>(["read_file"]);
  const [manualToolEdits, setManualToolEdits] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const skillGroups = useMemo(
    () => groupSkillsByCategory(availableSkills),
    [availableSkills]
  );

  useEffect(() => {
    if (manualToolEdits || !skills.length) return;
    setTools(mergeToolsFromSkills(skills, availableSkills));
  }, [skills, availableSkills, manualToolEdits]);

  if (!open) return null;

  function toggleSkill(skillId: string) {
    setSkills((prev) =>
      prev.includes(skillId) ? prev.filter((s) => s !== skillId) : [...prev, skillId]
    );
  }

  function toggleTool(tool: string) {
    setManualToolEdits(true);
    setTools((prev) =>
      prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool]
    );
  }

  function applySuggestedSkills() {
    const suggested = suggestSkillIdsForLabelRole(label, role, availableSkills);
    if (!suggested.length) return;
    setSkills(suggested);
    setManualToolEdits(false);
  }

  function applySuggestedModel() {
    const blob = `${label} ${role}`.toLowerCase();
    const writes =
      tools.includes("write_file") ||
      tools.includes("edit_file") ||
      /\b(implement|build|code|develop|engineer)\b/.test(blob);
    let pick = "copilot:gpt-4o";
    if (/\b(classif|route|triage|lightweight)\b/.test(blob) && !writes) pick = "copilot:gpt-4o-mini";
    else if (/\b(plan|research|architect|review|qa)\b/.test(blob) && !writes) pick = "copilot:gpt-4.1";
    else if (writes) pick = "copilot:gpt-4o";
    if (availableModels.includes(pick)) setModel(pick);
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
    if (!skills.length) {
      setError("Select at least one skill.");
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
      skills,
      tools,
      model: model || undefined,
      routesTo: [],
      position: { x: 200, y: 200 },
    });
    setLabel("");
    setId("");
    setRole("");
    setModel("");
    setSkills([]);
    setTools(["read_file"]);
    setManualToolEdits(false);
    setError(null);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-charcoal-surface rounded-2xl shadow-xl border border-charcoal-border w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 text-charcoal-text">
        <h2 className="text-lg font-semibold text-charcoal-text mb-1">Create agent</h2>
        <p className="text-sm text-charcoal-muted mb-4">
          Pick skills to define what this agent can do. Tools are auto-selected from skills; you can
          add extras (e.g. give a builder the testing skill).
        </p>

        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-charcoal-text mb-1">Label</label>
              <input
                className={inputClass}
                value={label}
                onChange={(e) => {
                  setLabel(e.target.value);
                  if (!id) setId(slugifyId(e.target.value));
                }}
                placeholder="Backend developer"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-charcoal-text mb-1">Id</label>
              <input
                className={`${inputClass} font-mono text-sm`}
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="backend_dev"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-charcoal-text mb-1">Role</label>
            <textarea
              className={inputClass}
              rows={2}
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Implements API endpoints and server-side logic."
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-charcoal-text">LLM model</label>
              <button
                type="button"
                onClick={applySuggestedModel}
                className="text-xs text-charcoal-accent hover:underline"
              >
                Suggest from role
              </button>
            </div>
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
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-charcoal-text">Skills</label>
              <button
                type="button"
                onClick={applySuggestedSkills}
                className="text-xs text-charcoal-accent hover:underline"
              >
                Suggest from role
              </button>
            </div>
            <div className="space-y-3 max-h-48 overflow-y-auto rounded-lg border border-charcoal-border p-3 bg-charcoal-bg">
              {skillGroups.map(([category, items]) => (
                <div key={category}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-muted mb-1.5">
                    {SKILL_CATEGORY_LABELS[category] ?? category}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {items.map((skill) => (
                      <button
                        key={skill.id}
                        type="button"
                        title={skill.description}
                        onClick={() => toggleSkill(skill.id)}
                        className={`px-2.5 py-1 rounded-full text-xs border ${
                          skills.includes(skill.id)
                            ? "bg-charcoal-accent/15 border-charcoal-accent/40 text-charcoal-accent"
                            : "bg-charcoal-raised border-charcoal-border text-charcoal-muted hover:text-charcoal-text"
                        }`}
                      >
                        {skill.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-charcoal-text mb-2">
              Tools{" "}
              <span className="font-normal text-charcoal-muted">(from skills + optional extras)</span>
            </label>
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
