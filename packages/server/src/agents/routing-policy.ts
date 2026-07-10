import { SOFTWARE_DEV_SUPERVISOR_RULES } from "./software-dev-pipeline.js";

export interface AgentRoutingRule {
  id: string;
  label: string;
  role: string;
  launchWhen: string[];
  doNotLaunchWhen: string[];
  tools: string[];
  routesTo: string[];
}

/** Kept for API / docs; live graph structure is designed by the LLM at runtime. */
export const AGENT_ROUTING_RULES: AgentRoutingRule[] = [
  {
    id: "planner",
    label: "Planner",
    role: "Plans implementation without writing production code.",
    launchWhen: ["Software build request."],
    doNotLaunchWhen: ["Pure Q&A."],
    tools: ["read_file", "manage_memory", "search_memory"],
    routesTo: ["builder"],
  },
  {
    id: "builder",
    label: "Builder",
    role: "Implements code in the workspace.",
    launchWhen: ["Plan ready."],
    doNotLaunchWhen: [],
    tools: ["shell", "read_file", "edit_file", "git_diff", "git_commit", "manage_memory", "search_memory"],
    routesTo: ["reviewer"],
  },
  {
    id: "reviewer",
    label: "Reviewer",
    role: "Reviews diff; at most one fix send-back.",
    launchWhen: ["Builder finished."],
    doNotLaunchWhen: [],
    tools: ["git_diff", "read_file"],
    routesTo: ["builder", "publisher"],
  },
  {
    id: "publisher",
    label: "Publisher",
    role: "Pushes and opens a PR.",
    launchWhen: ["Approved."],
    doNotLaunchWhen: [],
    tools: ["git_commit", "git_push", "create_github_repo", "init_git_repo", "open_pull_request", "shell"],
    routesTo: [],
  },
];

export const SUPERVISOR_ROUTING_RULES = SOFTWARE_DEV_SUPERVISOR_RULES;

export function buildSupervisorPrompt(): string {
  return buildSupervisorPromptFromRules(AGENT_ROUTING_RULES, [
    "planner",
    "builder",
    "reviewer",
    "publisher",
  ]);
}

export function buildSupervisorPromptFromRules(
  agentRules: AgentRoutingRule[],
  defaultFlow: string[]
): string {
  const agentSections = agentRules
    .map((rule) => {
      const launch = rule.launchWhen.map((w) => `  - ${w}`).join("\n");
      const avoid = rule.doNotLaunchWhen.map((w) => `  - ${w}`).join("\n");
      return (
        `### ${rule.label} (\`${rule.id}\`)\n` +
        `${rule.role}\n` +
        `Launch when:\n${launch || "  - (as needed)"}\n` +
        `Do NOT launch when:\n${avoid || "  - (no extra restrictions)"}\n` +
        `Tools: ${rule.tools.join(", ")}\n` +
        `May route to: ${rule.routesTo.length ? rule.routesTo.join(", ") : "END"}`
      );
    })
    .join("\n\n");

  const rules = SUPERVISOR_ROUTING_RULES.map((r) => `- ${r}`).join("\n");
  const flow = defaultFlow.length ? defaultFlow.join(" → ") : "sub-agents as needed";

  return (
    "You are the supervisor orchestrator. The chat is the primary control surface.\n\n" +
    "## Routing rules (strict — prevent loops)\n" +
    `${rules}\n` +
    `- Default flow hint: ${flow}\n` +
    `- When the user @mentions an agent or uses /launch, route to that agent first.\n\n` +
    "## Sub-agent policies\n\n" +
    `${agentSections || "(no workers deployed yet)"}`
  );
}

export function getRoutingPolicyForApi() {
  return {
    supervisor_rules: SUPERVISOR_ROUTING_RULES,
    agents: AGENT_ROUTING_RULES,
    default_flow: ["planner", "builder", "reviewer", "publisher"],
    retry_flow: ["builder", "reviewer"],
    available_tools: [
      "shell",
      "read_file",
      "edit_file",
      "git_diff",
      "git_commit",
      "git_push",
      "open_pull_request",
      "manage_memory",
      "search_memory",
      "publish_handoff",
      "read_pipeline_context",
    ],
    model_formats: ["copilot:gpt-4o", "openai:gpt-4.1", "openai:gpt-4o"],
    blank_canvas: true,
    auto_deploy: "llm_graph_design",
  };
}
