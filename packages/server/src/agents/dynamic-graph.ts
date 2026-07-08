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

let compiledCache: {
  hash: string;
  graph: ReturnType<ReturnType<typeof createSupervisor>["compile"]>;
} | null = null;

let sessionConfig: OrchestratorGraphConfig = getDefaultOrchestratorConfig();

function configHash(config: OrchestratorGraphConfig, targetAgent?: string): string {
  return JSON.stringify({ config, targetAgent: targetAgent ?? null });
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
  targetAgent?: string
): string {
  const rules = config.agents.map(toRoutingRule);
  const edgeHints = config.edges
    .map((e) => `- ${e.source} → ${e.target}${e.label ? ` (${e.label})` : ""}`)
    .join("\n");
  const flow = defaultFlowFromEdges(config.edges);
  const launchHint = targetAgent
    ? `\n\n## Active launch request\nThe user explicitly asked to route this turn to \`${targetAgent}\`. You MUST transfer to that agent first before any other agent.`
    : "";
  return (
    buildSupervisorPromptFromRules(rules, flow) +
    `\n\n## User-defined graph edges (authoritative routing topology)\n` +
    `Follow these edges when deciding the next agent. Do not skip required hops.\n` +
    `${edgeHints || "(no edges — choose freely among sub-agents)"}` +
    launchHint
  );
}

export function getCompiledGraphFromConfig(
  config?: OrchestratorGraphConfig,
  targetAgent?: string
) {
  const cfg = normalizeOrchestratorConfig(config ?? sessionConfig);
  const hash = configHash(cfg, targetAgent);
  if (compiledCache?.hash === hash) return compiledCache.graph;

  const workers = cfg.agents
    .filter((a) => a.id !== "supervisor")
    .map((agent) => buildWorkerFromConfig(agent));

  const supervisor = createSupervisor({
    agents: workers,
    llm: getModelForAgent(cfg.supervisorModel),
    prompt: buildSupervisorPromptFromConfig(cfg, targetAgent),
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
