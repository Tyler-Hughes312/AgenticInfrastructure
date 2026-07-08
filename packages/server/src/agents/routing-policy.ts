export interface AgentRoutingRule {
  id: string;
  label: string;
  role: string;
  launchWhen: string[];
  doNotLaunchWhen: string[];
  tools: string[];
  routesTo: string[];
}

export const AGENT_ROUTING_RULES: AgentRoutingRule[] = [
  {
    id: "coder",
    label: "Coder",
    role: "Implements code changes in the checked-out repository.",
    launchWhen: [
      "A new coding task arrives from the user.",
      "The reviewer requested changes or found issues in the diff.",
      "No implementation exists yet for the requested change.",
    ],
    doNotLaunchWhen: [
      "The reviewer has not yet inspected the latest diff (unless changes were requested).",
      "A pull request has already been opened for this task.",
    ],
    tools: ["shell", "read_file", "edit_file", "git_diff", "git_commit", "manage_memory", "search_memory"],
    routesTo: ["reviewer"],
  },
  {
    id: "reviewer",
    label: "Reviewer",
    role: "Inspects the diff for correctness, style, and risk without editing code.",
    launchWhen: [
      "The coder reports that implementation is complete.",
      "A git diff exists with changes to review.",
      "The supervisor needs a quality gate before opening a PR.",
    ],
    doNotLaunchWhen: [
      "No code changes have been made yet.",
      "The coder is still actively implementing.",
    ],
    tools: ["git_diff", "read_file"],
    routesTo: ["coder", "pr_opener"],
  },
  {
    id: "pr_opener",
    label: "PR Opener",
    role: "Opens a GitHub pull request for approved changes.",
    launchWhen: [
      "The reviewer has explicitly approved the changes.",
      "All requested fixes have been addressed and re-reviewed.",
    ],
    doNotLaunchWhen: [
      "The reviewer has not approved.",
      "The reviewer requested changes.",
      "No reviewed diff is ready to ship.",
    ],
    tools: ["open_pull_request"],
    routesTo: [],
  },
];

export const SUPERVISOR_ROUTING_RULES = [
  "You are the orchestrator. Never call tools directly — only route to sub-agents.",
  "Default flow: coder → reviewer → (coder if changes needed) → pr_opener when approved.",
  "Route to `coder` for any implementation, test fixes, or reviewer-requested changes.",
  "Route to `reviewer` only after the coder finishes and a diff is available.",
  "Route to `pr_opener` only after explicit reviewer approval — never skip review.",
  "If the reviewer requests changes, route back to `coder` with the feedback.",
  "Finish when the pull request is opened successfully.",
];

export function buildSupervisorPrompt(): string {
  return buildSupervisorPromptFromRules(AGENT_ROUTING_RULES, ["coder", "reviewer", "pr_opener"]);
}

export function buildSupervisorPromptFromRules(
  agentRules: AgentRoutingRule[],
  defaultFlow: string[]
): string {
  const agentSections = agentRules.map((rule) => {
    const launch = rule.launchWhen.map((w) => `  - ${w}`).join("\n");
    const avoid = rule.doNotLaunchWhen.map((w) => `  - ${w}`).join("\n");
    return (
      `### ${rule.label} (\`${rule.id}\`)\n` +
      `${rule.role}\n` +
      `Launch when:\n${launch}\n` +
      `Do NOT launch when:\n${avoid}\n` +
      `Tools: ${rule.tools.join(", ")}\n` +
      `May route to: ${rule.routesTo.length ? rule.routesTo.join(", ") : "END"}`
    );
  }).join("\n\n");

  const rules = SUPERVISOR_ROUTING_RULES.map((r) => `- ${r}`).join("\n");
  const flow = defaultFlow.length ? defaultFlow.join(" → ") : "sub-agents as needed";

  return (
    "You are the supervisor orchestrator. The chat is the primary control surface — users launch agents from chat.\n\n" +
    "## Routing rules\n" +
    `${rules}\n` +
    `- Default flow hint: ${flow}\n` +
    `- When the user @mentions an agent or uses /launch, route to that agent first.\n\n` +
    "## Sub-agent policies\n\n" +
    `${agentSections}`
  );
}

export function getRoutingPolicyForApi() {
  return {
    supervisor_rules: SUPERVISOR_ROUTING_RULES,
    agents: AGENT_ROUTING_RULES,
    default_flow: ["coder", "reviewer", "pr_opener"],
    retry_flow: ["coder", "reviewer"],
    available_tools: [
      "shell",
      "read_file",
      "edit_file",
      "git_diff",
      "git_commit",
      "open_pull_request",
      "manage_memory",
      "search_memory",
    ],
    model_formats: ["copilot:gpt-4o", "openai:gpt-4.1"],
  };
}
