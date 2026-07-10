import type { SkillDefinition } from "../lib/types/orchestrator";

const BASE_PIPELINE_TOOLS = [
  "publish_handoff",
  "read_pipeline_context",
  "manage_memory",
  "search_memory",
];

export function mergeToolsFromSkills(
  skillIds: string[],
  catalog: SkillDefinition[],
  manualTools: string[] = []
): string[] {
  const out = new Set<string>(BASE_PIPELINE_TOOLS);
  for (const id of skillIds) {
    const skill = catalog.find((s) => s.id === id);
    if (skill) {
      for (const t of skill.tools) out.add(t);
    }
  }
  for (const t of manualTools) out.add(t);
  return [...out];
}

export const SKILL_CATEGORY_LABELS: Record<string, string> = {
  research: "Research",
  planning: "Planning",
  development: "Development",
  quality: "Quality",
  devops: "DevOps",
  communication: "Communication",
};

export function groupSkillsByCategory(catalog: SkillDefinition[]) {
  const groups = new Map<string, SkillDefinition[]>();
  for (const skill of catalog) {
    const list = groups.get(skill.category) ?? [];
    list.push(skill);
    groups.set(skill.category, list);
  }
  return [...groups.entries()].sort(([a], [b]) =>
    (SKILL_CATEGORY_LABELS[a] ?? a).localeCompare(SKILL_CATEGORY_LABELS[b] ?? b)
  );
}

export function suggestSkillIdsForLabelRole(
  label: string,
  role: string,
  catalog: SkillDefinition[]
): string[] {
  const blob = `${label} ${role}`.toLowerCase();
  const rules: { pattern: RegExp; ids: string[] }[] = [
    { pattern: /\b(research|discovery|analyst|scout)\b/, ids: ["web_research", "document_analysis"] },
    { pattern: /\b(plan|planner|pm|product)\b/, ids: ["planning", "memory_notes"] },
    { pattern: /\b(architect|design|lead)\b/, ids: ["architecture", "document_analysis"] },
    {
      pattern: /\b(frontend|backend|full.?stack|builder|coder|dev|engineer)\b/,
      ids: ["implementation", "debugging"],
    },
    { pattern: /\b(qa|test|quality)\b/, ids: ["testing", "code_review"] },
    { pattern: /\b(review|reviewer)\b/, ids: ["code_review", "testing"] },
    { pattern: /\b(devops|publish|ship|release)\b/, ids: ["git_workflow", "github_publish"] },
    { pattern: /\b(writer|editor|copy)\b/, ids: ["technical_writing", "synthesis"] },
  ];
  const ids: string[] = [];
  for (const { pattern, ids: ruleIds } of rules) {
    if (pattern.test(blob)) ids.push(...ruleIds);
  }
  return ids.filter((id) => catalog.some((s) => s.id === id));
}
