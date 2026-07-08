import { createReactAgent } from "@langchain/langgraph/prebuilt";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { shellTool } from "../tools/shell.js";
import { readFile, editFile } from "../tools/file-editor.js";
import { gitDiff, gitCommit } from "../tools/git-ops.js";
import { openPullRequest } from "../tools/github-pr.js";
import { manageMemory, searchMemory } from "../memory/tools.js";
import { getModelForAgent } from "../models-llm.js";
import { AGENT_ROUTING_RULES, type AgentRoutingRule } from "./routing-policy.js";

export const AVAILABLE_TOOL_NAMES = [
  "shell",
  "read_file",
  "edit_file",
  "git_diff",
  "git_commit",
  "open_pull_request",
  "manage_memory",
  "search_memory",
] as const;

export type ToolName = (typeof AVAILABLE_TOOL_NAMES)[number];

const TOOL_MAP: Record<ToolName, StructuredToolInterface> = {
  shell: shellTool,
  read_file: readFile,
  edit_file: editFile,
  git_diff: gitDiff,
  git_commit: gitCommit,
  open_pull_request: openPullRequest,
  manage_memory: manageMemory,
  search_memory: searchMemory,
};

export type CustomAgentConfig = {
  id: string;
  label: string;
  role: string;
  prompt?: string;
  tools: string[];
  model?: string;
  routesTo: string[];
  launchWhen?: string[];
  doNotLaunchWhen?: string[];
  position?: { x: number; y: number };
};

export type GraphEdgeConfig = {
  source: string;
  target: string;
  label?: string;
};

export type OrchestratorGraphConfig = {
  agents: CustomAgentConfig[];
  edges: GraphEdgeConfig[];
  supervisorModel?: string;
};

function defaultPrompt(agent: CustomAgentConfig): string {
  return (
    `You are ${agent.label} (${agent.id}). ${agent.role}\n` +
    `Use your tools to complete work, then return control to the supervisor orchestrator.`
  );
}

export function resolveTools(toolNames: string[]): StructuredToolInterface[] {
  const tools: StructuredToolInterface[] = [];
  for (const name of toolNames) {
    const tool = TOOL_MAP[name as ToolName];
    if (tool) tools.push(tool);
  }
  return tools;
}

export function buildWorkerFromConfig(agent: CustomAgentConfig) {
  const tools = resolveTools(agent.tools);
  if (!tools.length) {
    throw new Error(`Agent "${agent.id}" has no valid tools configured`);
  }
  return createReactAgent({
    llm: getModelForAgent(agent.model),
    tools,
    name: agent.id,
    prompt: agent.prompt?.trim() || defaultPrompt(agent),
  });
}

export function toRoutingRule(agent: CustomAgentConfig): AgentRoutingRule {
  return {
    id: agent.id,
    label: agent.label,
    role: agent.role,
    launchWhen: agent.launchWhen ?? [`User or orchestrator routes work to ${agent.id}.`],
    doNotLaunchWhen: agent.doNotLaunchWhen ?? [],
    tools: agent.tools,
    routesTo: agent.routesTo,
  };
}

export function getDefaultOrchestratorConfig(): OrchestratorGraphConfig {
  return {
    agents: AGENT_ROUTING_RULES.map((rule, i) => ({
      id: rule.id,
      label: rule.label,
      role: rule.role,
      tools: rule.tools,
      routesTo: rule.routesTo,
      launchWhen: rule.launchWhen,
      doNotLaunchWhen: rule.doNotLaunchWhen,
      position: { x: 120, y: 80 + i * 140 },
    })),
    edges: [
      { source: "supervisor", target: "coder" },
      { source: "coder", target: "reviewer" },
      { source: "reviewer", target: "pr_opener", label: "if approved" },
      { source: "reviewer", target: "coder", label: "if changes needed" },
    ],
    supervisorModel: undefined,
  };
}

/** Derive each agent's routesTo from graph edges so connections drive routing. */
export function syncRoutesToFromEdges(
  agents: CustomAgentConfig[],
  edges: GraphEdgeConfig[]
): CustomAgentConfig[] {
  return agents.map((agent) => {
    const routesTo = [
      ...new Set(
        edges
          .filter((e) => e.source === agent.id)
          .map((e) => e.target)
          .filter((t) => t !== "supervisor" && t !== agent.id)
      ),
    ];
    return { ...agent, routesTo };
  });
}

export function defaultFlowFromEdges(edges: GraphEdgeConfig[]): string[] {
  const fromSupervisor = edges
    .filter((e) => e.source === "supervisor")
    .map((e) => e.target);
  if (fromSupervisor.length) {
    const flow = [...fromSupervisor];
    const seen = new Set(flow);
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of edges) {
        if (seen.has(e.source) && !seen.has(e.target) && e.target !== "supervisor") {
          flow.push(e.target);
          seen.add(e.target);
          changed = true;
        }
      }
    }
    return flow;
  }
  return edges
    .map((e) => e.target)
    .filter((id, i, arr) => id !== "supervisor" && arr.indexOf(id) === i);
}

export function normalizeOrchestratorConfig(
  input?: Partial<OrchestratorGraphConfig> | null
): OrchestratorGraphConfig {
  if (!input?.agents?.length) return getDefaultOrchestratorConfig();
  const edges = input.edges ?? [];
  return {
    agents: syncRoutesToFromEdges(input.agents, edges),
    edges,
    supervisorModel: input.supervisorModel,
  };
}
