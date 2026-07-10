import type { CustomAgentConfig, OrchestratorGraphConfig } from "./agent-registry.js";

/** Greetings, thanks, and meta chat that never need a pipeline. */
const DIRECT_CHAT_PATTERNS = [
  /^\s*(hi|hello|hey|thanks|thank you|ok|okay|sure|got it|cool|nice|great|yes|no|yep|nope)\s*[.!?]?\s*$/i,
  /^\s*(help|what can you do|how does this work|how do i use)\b/i,
];

/** Clear signals the user wants agents to execute work. */
const PIPELINE_EXECUTION_PATTERNS = [
  /\b(build|implement|create|run|execute|deploy|ship|commit|push|open pr|pull request)\b/i,
  /\b(research|investigate|analyze|analyse|write|draft|essay|report|summarize|summarise)\b/i,
  /\b(code|develop|scaffold|generate|fix|debug|refactor|test|verify)\b/i,
  /\b(make me|go ahead|do it|please run|please build|start the pipeline|run the pipeline)\b/i,
  /\b(create repo|github repo|new repo|new github|make a repo|create a repository)\b/i,
];

/** Task needs GitHub API access (repo create, push, PR) even on a local workspace. */
export function taskNeedsGithubToken(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return (
    /\b(create|new|make|provision|initialize)\b.{0,32}\b(github|git)\b.{0,32}\b(repo|repository)\b/i.test(t) ||
    /\b(push|pull request|\bpr\b|open pr)\b/i.test(t) ||
    /\b(github\.com)\b/i.test(t)
  );
}

/** Question-shaped messages that should not spawn agents unless paired with execution intent. */
const QUESTION_START =
  /^(what|how|why|when|where|who|which|is|are|can|could|would|should|do|does|did|explain|tell me|describe|list|show me)\b/i;

/**
 * Heuristic: does this message need the multi-agent pipeline?
 * Conservative — prefer direct chat when ambiguous.
 */
export function looksLikePipelineTask(text: string): boolean {
  const t = text.trim();
  if (!t) return false;

  for (const p of DIRECT_CHAT_PATTERNS) {
    if (p.test(t)) return false;
  }

  if (/\b(and then|then (build|run|execute|deploy|write|research))\b/i.test(t)) {
    return true;
  }

  for (const p of PIPELINE_EXECUTION_PATTERNS) {
    if (p.test(t)) return true;
  }

  // Long, detailed requests usually warrant a pipeline.
  if (t.length > 160) return true;

  // Pure questions without execution verbs → direct chat.
  if (QUESTION_START.test(t) && t.endsWith("?")) {
    return false;
  }
  if (QUESTION_START.test(t) && !PIPELINE_EXECUTION_PATTERNS.some((p) => p.test(t))) {
    return false;
  }

  // Short casual messages.
  if (t.length < 40 && !PIPELINE_EXECUTION_PATTERNS.some((p) => p.test(t))) {
    return false;
  }

  return false;
}

export function looksLikeDirectChat(text: string): boolean {
  return !looksLikePipelineTask(text);
}

/** Meta questions about the canvas/graph — always direct, never pipeline. */
export function looksLikeGraphMetaQuestion(text: string): boolean {
  return /\b(what agents|which agents|how many agents|explain (the |this )?(graph|pipeline|flow|team)|who is connected|what does .+ do)\b/i.test(
    text.trim()
  );
}

/** Concrete product / codebase the user wants built — not just canvas structure. */
const PRODUCT_DELIVERABLE_PATTERNS = [
  /\b(todo|web\s*app|mobile\s*app|saas|mvp|prototype|codebase)\b/i,
  /\b(application|website|landing\s*page|dashboard|portal|platform)\b/i,
  /\b(api|rest\s*api|graphql|microservice|backend|frontend|full.?stack)\b/i,
  /\b(next\.?js|react|vue|angular|svelte|express|fastapi|django|flask|rails)\b/i,
  /\b(full|complete|entire|whole)\b.{0,32}\b(project|app|application|system|product|codebase)\b/i,
  /\b(scaffold|implement|ship|deliver)\b.{0,40}\b(app|project|feature|system|product)\b/i,
  /\b(write|draft|research)\b.{0,32}\b(essay|report|paper|article|document)\b/i,
  /\b(push to github|open pr|pull request|create repo|github repo)\b/i,
];

export function looksLikeProductDeliverable(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return PRODUCT_DELIVERABLE_PATTERNS.some((p) => p.test(t));
}

/** User wants to create or extend agent team structure on the canvas — not execute work. */
const GRAPH_STRUCTURE_PATTERNS = [
  /\b(subagent|sub-agent|subagents|agent team|multi-?agent|agentic team|orchestrat|swarm)\b/i,
  /\b(build|create|make|add|set up|setup|design|deploy)\b.{0,48}\b(team|agents?|subagents?|graph|pipeline|workflow|infrastructure)\b/i,
  /\b(team|agents?|graph|pipeline|infrastructure)\b.{0,48}\b(build|create|make|add|setup|set up|into)\b/i,
  /\b(software dev|discovery|scrum|devops|qa|frontend|backend|full.?stack)\b.{0,32}\b(team|agent|subagent|role|pipeline)\b/i,
  /\brebuild\b.*\b(graph|pipeline|team|agents?)\b/i,
  /\bnew\b.*\b(agent team|pipeline|graph)\b/i,
  /\b(parallel|multiple|several)\b.{0,32}\b(dev|developer|coder|coding)\b/i,
  /\bmake\b.{0,24}\b(parallel|multiple)\b.{0,24}\b(dev|developer)\b/i,
];

export function looksLikeGraphDesignRequest(text: string, agentCount = 0): boolean {
  const t = text.trim();
  if (!t) return false;

  // Team + product in one message → run the pipeline, not canvas-only design.
  if (looksLikeProductDeliverable(t)) return false;

  for (const p of GRAPH_STRUCTURE_PATTERNS) {
    if (p.test(t)) return true;
  }

  // Extend an existing canvas with more specialist agents.
  if (
    agentCount > 0 &&
    /\b(subagent|agent team|multi-?agent|parallel|scrum|architect|coding agents?)\b/i.test(t) &&
    /\b(add|more|full|complete|expand|extend|make|build|create)\b/i.test(t)
  ) {
    return true;
  }

  return false;
}

/** Canvas team setup only — no concrete deliverable to build in this message. */
export function isTeamStructureOnly(text: string, agentCount = 0): boolean {
  return looksLikeGraphDesignRequest(text, agentCount) && !looksLikeProductDeliverable(text);
}

/**
 * Should we compile and run the LangGraph supervisor pipeline for this turn?
 */
export function shouldExecutePipeline(params: {
  task: string;
  graphConfig: OrchestratorGraphConfig;
  targetAgent?: string;
  intentKind: "task_run" | "q_and_a" | "graph_edit" | "graph_edit_pending";
}): boolean {
  const { task, graphConfig, targetAgent, intentKind } = params;

  if (intentKind !== "task_run") return false;

  // Explicit @agent / /launch routing always runs workers.
  if (targetAgent?.trim()) return true;

  if (looksLikeGraphMetaQuestion(task) || looksLikeDirectChat(task)) {
    return false;
  }

  if (!looksLikePipelineTask(task)) return false;

  // Blank canvas: only pipeline if the task clearly needs agents.
  if (!graphConfig.agents.length) {
    return looksLikePipelineTask(task);
  }

  // Existing graph + execution intent → run pipeline.
  return true;
}

export function graphContextForDirectReply(agents: CustomAgentConfig[]): string {
  if (!agents.length) {
    return (
      "The canvas is blank — no sub-agents are deployed yet. If the user asks to set up a team or pipeline, that is a graph design action (not something to describe in chat only). " +
      "If they ask to create a GitHub repo or build a coding project, tell them to describe the project and you will run agents that call create_github_repo — never send manual github.com UI steps."
    );
  }
  const lines = agents.map(
    (a) => `- ${a.id} (${a.label}): ${a.role.slice(0, 120)}`
  );
  return (
    `Current pipeline (${agents.length} agents):\n${lines.join("\n")}\n` +
    `Answer questions about the graph. If the user asks to add/build/extend the team or add parallel developers, tell them to send that as a graph design request — the system will call the LLM to design or refine the canvas (no fixed templates).`
  );
}
