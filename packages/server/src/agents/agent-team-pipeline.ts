import type {
  CustomAgentConfig,
  GraphEdgeConfig,
  OrchestratorGraphConfig,
} from "./agent-registry.js";
import type { ToolName } from "./agent-registry.js";

export function isAgentTeamDesignTask(task: string): boolean {
  const t = task.toLowerCase();
  const cues = [
    "agentic",
    "multi-agent",
    "multi agent",
    "subagent",
    "sub-agent",
    "scrum",
    "architect",
    "pipeline of",
    "coding agents",
    "agent system",
    "agents working",
    "orchestrat",
    "swarm",
  ];
  return cues.some((c) => t.includes(c)) || (t.includes("agent") && t.includes("parallel"));
}

function slug(label: string, fallback: string): string {
  const s = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return s && /^[a-z]/.test(s) ? s : fallback;
}

const TOOLKITS: Record<string, ToolName[]> = {
  scrum: ["shell", "read_file", "manage_memory", "search_memory"],
  architect: ["shell", "read_file", "edit_file", "git_diff", "manage_memory", "search_memory"],
  coder: [
    "shell",
    "read_file",
    "edit_file",
    "git_diff",
    "git_commit",
    "git_push",
    "manage_memory",
    "search_memory",
  ],
  tester: ["shell", "read_file", "edit_file", "git_diff", "manage_memory", "search_memory"],
  final: [
    "shell",
    "read_file",
    "edit_file",
    "git_diff",
    "git_commit",
    "manage_memory",
    "search_memory",
  ],
};

function skillBlock(kind: keyof typeof TOOLKITS, label: string, role: string): string {
  const tools = TOOLKITS[kind].join(", ");
  const skillLines: Record<keyof typeof TOOLKITS, string> = {
    scrum:
      "- Backlog skill: turn the user request into ordered work packages for specialist agents.\n" +
      "- Facilitation skill: keep agents unblocked; escalate conflicts to final review.\n" +
      "- Memory skill: store sprint goal and decisions with manage_memory / search_memory.",
    architect:
      "- Design skill: propose module boundaries, interfaces, and folder layout before coding forks.\n" +
      "- Constraint skill: document non-negotiables (stack, security, perf) for coders.\n" +
      "- Diff skill: read existing files before recommending structure changes.",
    coder:
      "- Implementation skill: write working code for your assigned slice only.\n" +
      "- Verification skill: run quick shell checks when useful.\n" +
      "- Git skill: prefer small commits; leave publishing/PR to publisher or final review as directed.",
    tester:
      "- QA skill: run targeted checks via shell; report failures with reproduction steps.\n" +
      "- Coverage skill: prioritize entrypoints and auth/critical flows.\n" +
      "- Hygiene skill: do not rewrite product code unless fixing a broken test harness.",
    final:
      "- Integration skill: reconcile outputs from all specialists into one coherent result.\n" +
      "- Acceptance skill: check the original user request is satisfied.\n" +
      "- Communication skill: write a clear final summary for the human including remaining risks.",
  };

  return (
    `You are ${label}. ${role}\n\n` +
    `## Loaded skills\n${skillLines[kind]}\n\n` +
    `## Available tools\n${tools}\n\n` +
    `Use only the tools you need. When your part is complete, return control to the supervisor. Do not loop endlessly.`
  );
}

/**
 * Build a visible multi-agent team from the user's prompt.
 * Specialists fan out from supervisor; final_review is the join node.
 * Each agent gets role tools + skill instructions.
 */
export function buildAgentTeamPipeline(task: string): OrchestratorGraphConfig {
  const t = task.toLowerCase();
  const specialists: {
    id: string;
    label: string;
    role: string;
    kind: keyof typeof TOOLKITS;
  }[] = [];

  if (/scrum|product\s*owner|po\b|pm\b/.test(t)) {
    specialists.push({
      id: "scrum_master",
      label: "Scrum Master",
      role: "Owns backlog priority, sprint goals, and coordination across agents.",
      kind: "scrum",
    });
  }
  if (/architect|architecture|design system|tech lead/.test(t)) {
    specialists.push({
      id: "architect",
      label: "Architect",
      role: "Defines structure, interfaces, and technical constraints for the system.",
      kind: "architect",
    });
  }

  const codingCount = /parallel|many|multiple|several/.test(t)
    ? 3
    : /coding|coder|builder|implement/.test(t)
      ? 2
      : 1;
  for (let i = 1; i <= Math.min(codingCount, 3); i++) {
    specialists.push({
      id: `coder_${i}`,
      label: `Coder ${i}`,
      role: `Implements a parallel slice of the coding work (slice ${i}).`,
      kind: "coder",
    });
  }

  if (/test|qa|quality|verify/.test(t)) {
    specialists.push({
      id: "tester",
      label: "Tester",
      role: "Writes/runs checks and reports failures for builder agents.",
      kind: "tester",
    });
  }

  specialists.push({
    id: "final_review",
    label: "Final Review",
    role: "Integrates all specialist output, resolves conflicts, and produces the final consolidated result.",
    kind: "final",
  });

  const seen = new Set<string>();
  const agents: CustomAgentConfig[] = specialists.map((s, i) => {
    let id = slug(s.id, `agent_${i + 1}`);
    while (seen.has(id)) id = `${id}_${i}`;
    seen.add(id);
    const isFinal = id === "final_review";
    const tools = [...TOOLKITS[s.kind]];
    return {
      id,
      label: s.label,
      role: s.role,
      prompt: skillBlock(s.kind, s.label, s.role),
      tools,
      routesTo: isFinal ? [] : ["final_review"],
      launchWhen: [`Supervisor routes work to ${s.label}.`],
      doNotLaunchWhen: [],
      position: {
        x: isFinal ? 320 : 40 + (i % 3) * 220,
        y: isFinal ? 420 : 140 + Math.floor(i / 3) * 160,
      },
    };
  });

  const edges: GraphEdgeConfig[] = [];
  for (const a of agents) {
    if (a.id === "final_review") continue;
    edges.push({ source: "supervisor", target: a.id, label: "parallel" });
    edges.push({ source: a.id, target: "final_review", label: "then" });
  }
  edges.push({ source: "supervisor", target: "final_review", label: "join" });

  return { agents, edges };
}
