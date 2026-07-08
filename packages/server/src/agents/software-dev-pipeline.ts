import type { OrchestratorGraphConfig, CustomAgentConfig, GraphEdgeConfig } from "./agent-registry.js";

/** Fixed software-dev pipeline — linear, one optional review loop. */
export function buildSoftwareDevPipeline(repoHint?: string): OrchestratorGraphConfig {
  const repoLine = repoHint?.trim()
    ? `Target repository: ${repoHint.trim()}. Prefer this remote for commits and PRs.`
    : "Use the run workspace / default repo URL from Settings for git and PRs.";

  const agents: CustomAgentConfig[] = [
    {
      id: "planner",
      label: "Planner",
      role: "Breaks the user request into a short implementation plan and file list. Does not write production code.",
      prompt:
        "You are Planner. Produce a concise plan: goals, files to create/change, acceptance checks. " +
        "Do NOT implement the full solution. When the plan is ready, stop and return control to the supervisor. " +
        "Do not call other agents.",
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
        "You are Builder. Implement the requested software in the workspace. " +
        `${repoLine} ` +
        "Create files, run smoke checks when useful, commit locally if appropriate. " +
        "When implementation is done for this pass, stop and return control. Do not open a PR. Do not loop forever.",
      tools: ["shell", "read_file", "edit_file", "git_diff", "git_commit", "manage_memory", "search_memory"],
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
        "You are Reviewer. Inspect the git diff and key files. " +
        "Either APPROVE (say clearly: APPROVED) or REQUEST CHANGES once with concrete feedback. " +
        "You do not edit code. After one review decision, stop.",
      tools: ["git_diff", "read_file"],
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
        "You are Publisher. " +
        `${repoLine} ` +
        "Commit if needed, push the branch, open a pull request, and return the PR URL. Then stop. " +
        "If there is no remote repo configured, explain that clearly and stop.",
      tools: ["git_diff", "git_commit", "git_push", "open_pull_request", "shell"],
      routesTo: [],
      launchWhen: ["Reviewer approved, or user asked to ship/publish."],
      doNotLaunchWhen: ["Reviewer requested changes that are not fixed yet."],
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
  ];
  if (cues.some((c) => t.includes(c))) return true;
  // Longer briefs are usually build requests
  return t.length > 120;
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
  "Never bounce endlessly between builder and reviewer. After one fix pass, go to publisher or END.",
  "If the user only asked a question (no build), answer briefly yourself and END — do not deploy loops.",
  "When publisher returns a PR URL (or explains no repo), END immediately.",
  "Do not re-call planner after the plan is done.",
];
