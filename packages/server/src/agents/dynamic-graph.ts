import { createSupervisor } from "@langchain/langgraph-supervisor";
import { getCheckpointer, getStore } from "../db.js";
import { getModelForAgent } from "../models-llm.js";
import {
  buildWorkerFromConfig,
  defaultFlowFromEdges,
  getDefaultOrchestratorConfig,
  normalizeOrchestratorConfig,
  toRoutingRule,
  type OrchestratorGraphConfig,
} from "./agent-registry.js";
import { buildSupervisorPromptFromRules } from "./routing-policy.js";
import { isRemoteRepo } from "../tools/git-ops.js";

let compiledCache: {
  hash: string;
  graph: any;
} | null = null;

let sessionConfig: OrchestratorGraphConfig = getDefaultOrchestratorConfig();

function configHash(
  config: OrchestratorGraphConfig,
  targetAgent?: string,
  repoUrl?: string
): string {
  return JSON.stringify({ config, targetAgent: targetAgent ?? null, repoUrl: repoUrl ?? null });
}

function repoProvisioningSupervisorNote(repoUrl?: string): string {
  if (isRemoteRepo(repoUrl)) return "";
  return (
    `\n\n## Repository provisioning (local workspace)\n` +
    `- This session has local git only — no GitHub remote yet.\n` +
    `- For coding tasks that need GitHub, route to publisher/devops to call \`create_github_repo\` before \`git_push\`.\n` +
    `- Never instruct the user to click through github.com manually; agents provision repos via tools.\n`
  );
}

export function setSessionOrchestratorConfig(config?: OrchestratorGraphConfig | null): void {
  sessionConfig = normalizeOrchestratorConfig(config);
  compiledCache = null;
}

/** Drop cached compiled graphs so the next run rebuilds LLMs with current credentials. */
export function clearCompiledGraphCache(): void {
  compiledCache = null;
}

export function getSessionOrchestratorConfig(): OrchestratorGraphConfig {
  return sessionConfig;
}

export function buildSupervisorPromptFromConfig(
  config: OrchestratorGraphConfig,
  targetAgent?: string,
  repoUrl?: string
): string {
  const rules = config.agents.map(toRoutingRule);
  const edgeHints = config.edges
    .map((e) => `- ${e.source} → ${e.target}${e.label ? ` (${e.label})` : ""}`)
    .join("\n");
  const flow = defaultFlowFromEdges(config.edges);
  const handoffRules =
    `\n\n## Pipeline data flow (strict)\n` +
    `- Follow graph edges in order. Do not skip an agent whose upstream handoff is required.\n` +
    `- Route to the next agent only after the current agent has called \`publish_handoff\`.\n` +
    `- Default sequential flow: ${flow.length ? flow.join(" → ") : "as edges define"}.\n` +
    `- When an agent finishes without a handoff, send them back once to publish_handoff, then continue.\n` +
    `- Do NOT end the run until every agent in the flow has been visited at least once for full-project tasks.\n` +
    `- For coding deliverables, do not END until an implementer has written files to the workspace.\n`;
  const launchHint = targetAgent
    ? `\n\n## Active launch request\nThe user explicitly asked to route this turn to \`${targetAgent}\`. You MUST transfer to that agent first before any other agent.`
    : "";
  return (
    buildSupervisorPromptFromRules(rules, flow) +
    `\n\n## User-defined graph edges (authoritative routing topology)\n` +
    `Follow these edges when deciding the next agent. Do not skip required hops.\n` +
    `${edgeHints || "(no edges — choose freely among sub-agents)"}` +
    handoffRules +
    repoProvisioningSupervisorNote(repoUrl) +
    launchHint
  );
}

export function getCompiledGraphFromConfig(
  config?: OrchestratorGraphConfig,
  targetAgent?: string,
  repoUrl?: string
) {
  const cfg = normalizeOrchestratorConfig(config ?? sessionConfig);
  const hash = configHash(cfg, targetAgent, repoUrl);
  if (compiledCache?.hash === hash) return compiledCache.graph;

  const workers = cfg.agents
    .filter((a) => a.id !== "supervisor")
    .map((agent) => buildWorkerFromConfig(agent));

  if (!workers.length) {
    throw new Error(
      "NO_WORKERS: blank canvas has no sub-agents. Auto-deploy a pipeline for software tasks, or ask a question for a direct reply."
    );
  }

  const supervisor = createSupervisor({
    agents: workers,
    llm: getModelForAgent(cfg.supervisorModel),
    prompt: buildSupervisorPromptFromConfig(cfg, targetAgent, repoUrl),
  });

  const compiled = supervisor.compile({
    checkpointer: getCheckpointer(),
    store: getStore(),
  });

  compiledCache = { hash, graph: compiled };
  sessionConfig = cfg;
  return compiled;
}

export function getGraphSchemaFromConfig(config?: OrchestratorGraphConfig) {
  const cfg = normalizeOrchestratorConfig(config ?? sessionConfig);
  const workerIds = cfg.agents.filter((a) => a.id !== "supervisor").map((a) => a.id);
  const nodes = [
    { id: "supervisor", label: "supervisor" },
    ...workerIds.map((id) => {
      const agent = cfg.agents.find((a) => a.id === id);
      return { id, label: agent?.label ?? id };
    }),
  ];
  return { nodes, edges: cfg.edges };
}
