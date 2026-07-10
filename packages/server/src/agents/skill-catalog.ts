import type { ToolName } from "./agent-registry.js";
import type { CustomAgentConfig } from "./agent-registry.js";

export type SkillCategory =
  | "research"
  | "planning"
  | "development"
  | "quality"
  | "devops"
  | "communication";

export type SkillDefinition = {
  id: string;
  label: string;
  description: string;
  category: SkillCategory;
  tools: ToolName[];
  /** Behavioral instructions injected into the agent system prompt. */
  instructions: string;
};

/** Creator-selectable skills — map to tools and prompt guidance. */
export const SKILL_CATALOG: SkillDefinition[] = [
  {
    id: "web_research",
    label: "Web research",
    description: "Gather facts from the web and external sources; cite findings.",
    category: "research",
    tools: ["shell", "read_file", "search_memory", "manage_memory"],
    instructions:
      "Search and synthesize external information. Use shell for curl/wget when needed. " +
      "Store sources and key findings in memory. Prefer primary sources.",
  },
  {
    id: "document_analysis",
    label: "Document analysis",
    description: "Read and extract structure from files, specs, and repo docs.",
    category: "research",
    tools: ["read_file", "search_memory", "manage_memory"],
    instructions:
      "Read relevant files before acting. Summarize structure, dependencies, and gaps. " +
      "Reference file paths in handoffs.",
  },
  {
    id: "planning",
    label: "Planning",
    description: "Break work into steps, acceptance criteria, and sequencing.",
    category: "planning",
    tools: ["read_file", "manage_memory", "search_memory"],
    instructions:
      "Produce a concise plan with goals, file touch list, and done-when checks. " +
      "Do not implement — hand off to builders.",
  },
  {
    id: "architecture",
    label: "Architecture",
    description: "Define modules, interfaces, and technical constraints.",
    category: "planning",
    tools: ["read_file", "edit_file", "git_diff", "manage_memory", "search_memory"],
    instructions:
      "Propose boundaries, data contracts, and folder layout. Document non-negotiables " +
      "(security, perf, stack) for downstream agents.",
  },
  {
    id: "implementation",
    label: "Implementation",
    description: "Write and edit production code in the workspace.",
    category: "development",
    tools: ["shell", "read_file", "write_file", "edit_file", "git_diff", "manage_memory"],
    instructions:
      "Implement assigned scope fully — not stubs or placeholders. " +
      "You MUST call write_file/edit_file to create real source files before publish_handoff. " +
      "Prefer small, verifiable edits. Run quick shell checks when useful.",
  },
  {
    id: "debugging",
    label: "Debugging",
    description: "Diagnose failures, trace errors, and fix root causes.",
    category: "development",
    tools: ["shell", "read_file", "edit_file", "git_diff", "manage_memory"],
    instructions:
      "Reproduce the issue, inspect logs/output, isolate root cause, apply minimal fix. " +
      "Document what broke and how it was fixed.",
  },
  {
    id: "testing",
    label: "Testing",
    description: "Run tests, write checks, and report failures — usable by any agent, not only QA roles.",
    category: "quality",
    tools: ["shell", "read_file", "edit_file", "git_diff", "manage_memory"],
    instructions:
      "Run targeted test commands via shell. Report failures with reproduction steps. " +
      "Add or fix tests when appropriate; avoid unrelated product rewrites.",
  },
  {
    id: "code_review",
    label: "Code review",
    description: "Review diffs for correctness, style, and risk.",
    category: "quality",
    tools: ["read_file", "git_diff", "manage_memory"],
    instructions:
      "Inspect git_diff and critical files. Flag blockers vs nits. Do not rewrite large swaths unless asked.",
  },
  {
    id: "refactoring",
    label: "Refactoring",
    description: "Improve structure without changing behavior.",
    category: "development",
    tools: ["read_file", "edit_file", "shell", "git_diff", "manage_memory"],
    instructions:
      "Keep behavior stable. Prefer incremental refactors with tests or smoke checks after each pass.",
  },
  {
    id: "technical_writing",
    label: "Technical writing",
    description: "Draft docs, reports, essays, and user-facing copy.",
    category: "communication",
    tools: ["read_file", "write_file", "write_document", "manage_memory", "search_memory"],
    instructions:
      "Write clearly for the intended audience. Honor length and format constraints from the task. " +
      "Save deliverables with write_document to docs/ or output/ (.md, .txt, .html, .docx).",
  },
  {
    id: "synthesis",
    label: "Synthesis",
    description: "Merge upstream handoffs into one coherent deliverable.",
    category: "communication",
    tools: ["read_file", "manage_memory", "search_memory"],
    instructions:
      "Read all upstream context. Resolve conflicts. Produce a unified answer for the user or next agent.",
  },
  {
    id: "git_workflow",
    label: "Git workflow",
    description: "Branches, commits, diffs, and local git hygiene.",
    category: "devops",
    tools: ["git_create_branch", "git_diff", "git_commit", "git_push", "read_file", "shell"],
    instructions:
      "Use focused commits with clear messages. Inspect git_diff before committing. Do not force-push.",
  },
  {
    id: "repo_provisioning",
    label: "Repo provisioning",
    description: "Initialize local git and create GitHub repositories for new coding projects.",
    category: "devops",
    tools: ["init_git_repo", "create_github_repo", "git_commit", "git_push", "git_diff", "shell"],
    instructions:
      "When no GitHub remote exists, call create_github_repo first (derive name from the project). " +
      "Local git is usually pre-initialized; use init_git_repo if needed. Then commit and push.",
  },
  {
    id: "github_publish",
    label: "GitHub publish",
    description: "Create repos, push, and open pull requests.",
    category: "devops",
    tools: ["create_github_repo", "init_git_repo", "git_push", "open_pull_request", "git_commit", "git_diff", "shell"],
    instructions:
      "If origin is missing, call create_github_repo before git_push. Push branch and open PR with a useful title/body. Return the PR URL.",
  },
  {
    id: "memory_notes",
    label: "Memory & notes",
    description: "Persist decisions and recall context across turns.",
    category: "planning",
    tools: ["manage_memory", "search_memory", "read_file"],
    instructions:
      "Store durable decisions and lookup prior notes before repeating work.",
  },
];

const SKILL_BY_ID = new Map(SKILL_CATALOG.map((s) => [s.id, s]));

/** Always available for pipeline agents. */
export const BASE_PIPELINE_TOOLS: ToolName[] = [
  "publish_handoff",
  "read_pipeline_context",
  "manage_memory",
  "search_memory",
];

export function getSkillCatalog(): SkillDefinition[] {
  return SKILL_CATALOG;
}

export function getSkillCatalogForApi(): {
  id: string;
  label: string;
  description: string;
  category: SkillCategory;
  tools: ToolName[];
}[] {
  return SKILL_CATALOG.map(({ id, label, description, category, tools }) => ({
    id,
    label,
    description,
    category,
    tools,
  }));
}

export function getSkillById(id: string): SkillDefinition | undefined {
  return SKILL_BY_ID.get(id);
}

/** Map freeform skill text (from LLM or labels) to a catalog id. */
export function matchSkillId(text: string): string | undefined {
  const t = text.trim().toLowerCase();
  if (!t) return undefined;
  if (SKILL_BY_ID.has(t)) return t;

  for (const skill of SKILL_CATALOG) {
    const label = skill.label.toLowerCase();
    if (t === label || t.includes(label) || label.includes(t)) return skill.id;
    if (t.replace(/\s+/g, "_") === skill.id) return skill.id;
  }

  // Keyword fallbacks for legacy / LLM freeform skills
  const KEYWORD_MAP: { pattern: RegExp; id: string }[] = [
    { pattern: /\b(web|research|investigate|gather)\b/i, id: "web_research" },
    { pattern: /\b(plan|scope|backlog)\b/i, id: "planning" },
    { pattern: /\b(architect|design system|module)\b/i, id: "architecture" },
    { pattern: /\b(implement|code|build|develop)\b/i, id: "implementation" },
    { pattern: /\b(debug|trace|diagnos)\b/i, id: "debugging" },
    { pattern: /\b(test|qa|verify|validate)\b/i, id: "testing" },
    { pattern: /\b(review|critique|audit)\b/i, id: "code_review" },
    { pattern: /\b(refactor|cleanup)\b/i, id: "refactoring" },
    { pattern: /\b(write|draft|essay|report|document)\b/i, id: "technical_writing" },
    { pattern: /\b(synthes|integrat|finaliz|compile)\b/i, id: "synthesis" },
    { pattern: /\b(git|commit|branch|diff)\b/i, id: "git_workflow" },
    { pattern: /\b(github|pull request|\bpr\b|publish|ship)\b/i, id: "github_publish" },
  ];
  for (const { pattern, id } of KEYWORD_MAP) {
    if (pattern.test(t)) return id;
  }
  return undefined;
}

export function normalizeSkillIds(skills: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of skills) {
    const id = matchSkillId(s) ?? (SKILL_BY_ID.has(s) ? s : undefined);
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export function resolveSkills(skillIds: string[]): SkillDefinition[] {
  return normalizeSkillIds(skillIds)
    .map((id) => SKILL_BY_ID.get(id))
    .filter((s): s is SkillDefinition => Boolean(s));
}

/** Union of tools required by selected skills plus pipeline base tools. */
export function toolsFromSkillIds(skillIds: string[], extra: ToolName[] = []): ToolName[] {
  const out = new Set<ToolName>(BASE_PIPELINE_TOOLS);
  for (const skill of resolveSkills(skillIds)) {
    for (const t of skill.tools) out.add(t);
  }
  for (const t of extra) out.add(t);
  return [...out];
}

export function formatSkillsForPrompt(skillIds: string[]): string {
  const skills = resolveSkills(skillIds);
  if (!skills.length) return "";
  const lines = skills.map(
    (s) => `### ${s.label} (\`${s.id}\`)\n${s.instructions}`
  );
  return `\n## Loaded skills\n${lines.join("\n\n")}\n`;
}

export function suggestSkillIdsForRole(label: string, role: string): string[] {
  const blob = `${label} ${role}`.toLowerCase();
  const suggested: string[] = [];

  const rules: { pattern: RegExp; ids: string[] }[] = [
    { pattern: /\b(research|discovery|analyst|scout)\b/, ids: ["web_research", "document_analysis"] },
    { pattern: /\b(plan|planner|pm|product)\b/, ids: ["planning", "memory_notes"] },
    { pattern: /\b(architect|design|lead)\b/, ids: ["architecture", "document_analysis"] },
    { pattern: /\b(frontend|backend|full.?stack|builder|coder|dev|engineer)\b/, ids: ["implementation", "debugging"] },
    { pattern: /\b(qa|test|quality)\b/, ids: ["testing", "code_review"] },
    { pattern: /\b(review|reviewer)\b/, ids: ["code_review", "testing"] },
    { pattern: /\b(devops|publish|ship|release)\b/, ids: ["git_workflow", "github_publish"] },
    { pattern: /\b(writer|editor|copy)\b/, ids: ["technical_writing", "synthesis"] },
  ];

  for (const { pattern, ids } of rules) {
    if (pattern.test(blob)) suggested.push(...ids);
  }
  return [...new Set(suggested)];
}

/** Legacy keyword inference — used when skills are freeform strings from LLM design. */
const SKILL_TOOL_RULES: { pattern: RegExp; tools: ToolName[] }[] = [
  { pattern: /\b(research|investigate|gather|source|web)\b/i, tools: ["shell", "read_file", "search_memory"] },
  { pattern: /\b(write|draft|essay|report|summar|author|compose)\b/i, tools: ["read_file", "manage_memory"] },
  { pattern: /\b(edit|implement|code|build|develop|refactor|fix)\b/i, tools: ["read_file", "edit_file", "shell"] },
  { pattern: /\b(review|critique|qa|quality|audit)\b/i, tools: ["read_file", "git_diff"] },
  { pattern: /\b(test|verify|validate)\b/i, tools: ["shell", "read_file"] },
  { pattern: /\b(git|commit|push|ship|publish|pr|pull request|github)\b/i, tools: ["git_diff", "git_commit", "git_push", "open_pull_request", "create_github_repo"] },
  { pattern: /\b(create|new|provision|initialize)\b.*\b(repo|repository)\b/i, tools: ["init_git_repo", "create_github_repo", "git_commit", "git_push"] },
  { pattern: /\b(plan|architect|design|scope|outline)\b/i, tools: ["read_file", "manage_memory", "search_memory"] },
  { pattern: /\b(synthesize|integrate|finalize|deliver|compile)\b/i, tools: ["read_file", "manage_memory"] },
];

/** Infer tool names from catalog skill ids and/or freeform skill strings. */
export function inferToolsFromSkills(
  skills: string[],
  role: string,
  consumes: string,
  produces: string
): ToolName[] {
  const catalogIds = normalizeSkillIds(skills);
  if (catalogIds.length) {
    return toolsFromSkillIds(catalogIds);
  }

  const blob = [role, consumes, produces, ...skills].join(" ");
  const out = new Set<ToolName>(BASE_PIPELINE_TOOLS);

  for (const rule of SKILL_TOOL_RULES) {
    if (rule.pattern.test(blob)) {
      for (const t of rule.tools) out.add(t);
    }
  }

  if (/\b(implement|code|build|edit)\b/i.test(blob)) {
    out.add("read_file");
    out.add("write_file");
    out.add("edit_file");
    out.add("shell");
  }

  return [...out];
}

/** Merge LLM-chosen tools with skill-inferred tools (deduped, stable order). */
export function mergeAgentTools(designed: ToolName[], inferred: ToolName[]): ToolName[] {
  const seen = new Set<string>();
  const merged: ToolName[] = [];
  for (const t of [...designed, ...inferred]) {
    if (seen.has(t)) continue;
    seen.add(t);
    merged.push(t);
  }
  return merged.length ? merged : [...BASE_PIPELINE_TOOLS];
}

/** Apply catalog skills to an agent: normalize ids, merge tools, enrich prompt. */
export function enrichAgentWithSkills(agent: CustomAgentConfig): CustomAgentConfig {
  const skillIds = normalizeSkillIds(agent.skills ?? []);
  if (!skillIds.length) return agent;

  const inferred = toolsFromSkillIds(skillIds);
  const tools = mergeAgentTools(
    (agent.tools ?? []) as ToolName[],
    inferred
  );

  const skillBlock = formatSkillsForPrompt(skillIds);
  let prompt = agent.prompt?.trim() ?? "";
  if (!prompt) {
    prompt =
      `You are ${agent.label} (${agent.id}). ${agent.role}\n` +
      `Use your tools to complete work, then return control to the supervisor.`;
  }
  if (!prompt.includes("## Loaded skills")) {
    prompt = `${prompt}${skillBlock}`;
  }

  return { ...agent, skills: skillIds, tools, prompt };
}
