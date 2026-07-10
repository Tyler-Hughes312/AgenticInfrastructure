import type { OrchestratorGraphConfig, CustomAgentConfig, GraphEdgeConfig } from "./agent-registry.js";

/** Fixed software-dev pipeline — linear, one optional review loop. */
export function buildSoftwareDevPipeline(repoHint?: string): OrchestratorGraphConfig {
  const repoLine = repoHint?.trim()
    ? `Target repository: ${repoHint.trim()}. Prefer this remote for commits and PRs.`
    : "No GitHub remote is configured yet. The publisher MUST call create_github_repo to provision one before git_push.";

  const agents: CustomAgentConfig[] = [
    {
      id: "planner",
      label: "Planner",
      role: "Breaks the user request into a short implementation plan and file list. Does not write production code.",
      prompt:
        "You are Planner.\n## Skills\n- Scope skill: turn the request into goals, files, and acceptance checks.\n" +
        "- Sequencing skill: order work for Builder → Reviewer → Publisher.\n" +
        "- Memory skill: use manage_memory/search_memory for durable notes.\n" +
        "## Tools\nread_file, manage_memory, search_memory\n" +
        "Do NOT implement the full solution. When the plan is ready, stop.",
      tools: ["read_file", "manage_memory", "search_memory"],
      routesTo: ["builder"],
      launchWhen: ["New software or build request that needs planning."],
      doNotLaunchWhen: ["Pure Q&A with no implementation work."],
      position: { x: 80, y: 160 },
    },
    {
      id: "builder",
      label: "Builder",
      role: "Implements the plan in the workspace using shell and file tools.",
      prompt:
        "You are Builder.\n" +
        `${repoLine}\n` +
        "## Skills\n- Implementation skill: create/edit files to satisfy the plan.\n" +
        "- Smoke-test skill: run quick shell checks when useful.\n" +
        "- Git skill: commit locally when appropriate; do not open a PR.\n" +
        "## Tools\nshell, read_file, edit_file, git_diff, git_commit, git_push, manage_memory, search_memory\n" +
        "When this pass is done, stop and return control. Do not loop forever.",
      tools: [
        "shell",
        "read_file",
        "edit_file",
        "git_diff",
        "git_commit",
        "git_push",
        "manage_memory",
        "search_memory",
      ],
      routesTo: ["reviewer"],
      launchWhen: ["Planner finished, or user asked for implementation."],
      doNotLaunchWhen: ["Reviewer already requested a second rebuild in this turn."],
      position: { x: 80, y: 300 },
    },
    {
      id: "reviewer",
      label: "Reviewer",
      role: "Reviews the diff once; may request at most one fix pass.",
      prompt:
        "You are Reviewer.\n## Skills\n- Diff review skill: inspect git_diff and key files.\n" +
        "- Risk skill: approve unless there is a critical blocker.\n" +
        "## Tools\ngit_diff, read_file, shell, manage_memory\n" +
        "End with exactly one of:\nDECISION: APPROVED\nor\nDECISION: REQUEST_CHANGES\n" +
        "Do not edit code. After the decision line, stop.",
      tools: ["git_diff", "read_file", "shell", "manage_memory"],
      routesTo: ["builder", "publisher"],
      launchWhen: ["Builder finished a pass."],
      doNotLaunchWhen: ["No diff exists yet."],
      position: { x: 80, y: 440 },
    },
    {
      id: "publisher",
      label: "Publisher",
      role: "Pushes and opens a pull request to the target GitHub repository.",
      prompt:
        "You are Publisher.\n" +
        `${repoLine}\n` +
        "## Skills\n- Ship skill: create GitHub repo if needed, commit, push branch, open PR, return URL.\n" +
        "- Repo skill: if no origin remote, call create_github_repo first with a sensible repo name.\n" +
        "## Tools\ngit_diff, git_commit, git_push, create_github_repo, init_git_repo, open_pull_request, shell, read_file\n" +
        "Do not tell the user to create a repo manually in the GitHub UI. Use create_github_repo. Do not wait for further human confirmation once invoked.",
      tools: [
        "git_diff",
        "git_commit",
        "git_push",
        "create_github_repo",
        "init_git_repo",
        "open_pull_request",
        "shell",
        "read_file",
      ],
      routesTo: [],
      launchWhen: [
        "Reviewer ended with DECISION: APPROVED.",
        "User said approve, ship, publish, or open the PR.",
      ],
      doNotLaunchWhen: ["Reviewer ended with DECISION: REQUEST_CHANGES and builder has not fixed yet."],
      position: { x: 80, y: 580 },
    },
  ];

  const edges: GraphEdgeConfig[] = [
    { source: "supervisor", target: "planner" },
    { source: "planner", target: "builder" },
    { source: "builder", target: "reviewer" },
    { source: "reviewer", target: "publisher", label: "if approved" },
    { source: "reviewer", target: "builder", label: "fix once" },
  ];

  return { agents, edges };
}

export function isLegacyLoopingConfig(config?: OrchestratorGraphConfig | null): boolean {
  if (!config?.agents?.length) return false;
  const ids = new Set(config.agents.map((a) => a.id));
  return ids.has("coder") && ids.has("reviewer") && ids.has("pr_opener");
}

export function isBlankWorkerGraph(config?: OrchestratorGraphConfig | null): boolean {
  return !config?.agents?.length;
}

/** Heuristic: should we deploy the software-dev pipeline for this prompt? */
export function isSoftwareDevTask(task: string): boolean {
  const t = task.toLowerCase();
  const cues = [
    "build",
    "make",
    "create",
    "implement",
    "frontend",
    "backend",
    "full stack",
    "python",
    "react",
    "next",
    "page",
    "sign in",
    "signin",
    "login",
    "signup",
    "form",
    "ui",
    "app",
    "website",
    "api",
    "repo",
    "github",
    "pull request",
    "feature",
    "bug",
    "fix",
    "scaffold",
    "html",
    "css",
    "django",
    "flask",
    "fastapi",
    "agent",
    "agentic",
    "pipeline",
    "scrum",
    "architect",
    "coding",
    "tester",
    "parallel",
  ];
  if (cues.some((c) => t.includes(c))) return true;
  // Longer briefs are usually build requests
  return t.length > 80;
}

export function extractRepoHint(task: string): string | undefined {
  const m = task.match(/github\.com\/[^\s)+'\"]+/i);
  if (m) return `https://${m[0].replace(/^https?:\/\//i, "")}`;
  return undefined;
}

export const SOFTWARE_DEV_SUPERVISOR_RULES = [
  "You are the orchestrator. Prefer transferring to sub-agents over solving large builds yourself.",
  "Default flow: planner → builder → reviewer → publisher.",
  "Transfer to each stage AT MOST ONCE per user turn, except reviewer may send builder ONE fix pass only.",
  "CRITICAL: When reviewer returns DECISION: APPROVED (or clearly approves), you MUST immediately transfer to publisher in the SAME turn. Do NOT wait for the human user to approve.",
  "If the user message is approve / ship / publish / open pr / LGTM, transfer straight to publisher.",
  "Never bounce endlessly between builder and reviewer. After one fix pass + re-review, go to publisher or END.",
  "If the user only asked a question (no build), answer briefly yourself and END — do not deploy loops.",
  "When publisher returns a PR URL (or explains no repo), END immediately.",
  "If the workspace has no GitHub remote, publisher must call create_github_repo before git_push — never ask the human to create a repo in the browser.",
  "Do not re-call planner after the plan is done.",
];
