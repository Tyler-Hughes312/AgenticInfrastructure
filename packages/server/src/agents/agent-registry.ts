import { createReactAgent } from "@langchain/langgraph/prebuilt";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { shellTool } from "../tools/shell.js";
import { readFile, editFile, writeFile, writeDocument } from "../tools/file-editor.js";
import { gitCreateBranch, gitDiff, gitCommit, gitPush, initGitRepo } from "../tools/git-ops.js";
import { createGithubRepo, openPullRequest } from "../tools/github-pr.js";
import { manageMemory, searchMemory } from "../memory/tools.js";
import { publishHandoff, readPipelineContext } from "../tools/pipeline-handoff.js";
import { getModelForAgent } from "../models-llm.js";
import type { AgentRoutingRule } from "./routing-policy.js";
import { enrichAgentWithSkills } from "./skill-catalog.js";
import { BEDROCK_GPT_OSS_120B, suggestModelForRole } from "./role-model-presets.js";

export const AVAILABLE_TOOL_NAMES = [
  "shell",
  "read_file",
  "write_file",
  "write_document",
  "edit_file",
  "init_git_repo",
  "git_create_branch",
  "git_diff",
  "git_commit",
  "git_push",
  "create_github_repo",
  "open_pull_request",
  "manage_memory",
  "search_memory",
  "publish_handoff",
  "read_pipeline_context",
] as const;

export type ToolName = (typeof AVAILABLE_TOOL_NAMES)[number];

const TOOL_MAP: Record<ToolName, StructuredToolInterface> = {
  shell: shellTool,
  read_file: readFile,
  write_file: writeFile,
  write_document: writeDocument,
  edit_file: editFile,
  init_git_repo: initGitRepo,
  git_create_branch: gitCreateBranch,
  git_diff: gitDiff,
  git_commit: gitCommit,
  git_push: gitPush,
  create_github_repo: createGithubRepo,
  open_pull_request: openPullRequest,
  manage_memory: manageMemory,
  search_memory: searchMemory,
  publish_handoff: publishHandoff,
  read_pipeline_context: readPipelineContext,
};

export type CustomAgentConfig = {
  id: string;
  label: string;
  role: string;
  prompt?: string;
  tools: string[];
  skills?: string[];
  consumes?: string;
  produces?: string;
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

export type DeliverableMode =
  | { type: "chat" }
  | { type: "github"; pr?: boolean }
  | { type: "both"; pr?: boolean };

export type OrchestratorGraphConfig = {
  agents: CustomAgentConfig[];
  edges: GraphEdgeConfig[];
  supervisorModel?: string;
  deliverableMode?: DeliverableMode;
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

/** Blank project canvas — supervisor only until a task auto-deploys workers. */
export function getDefaultOrchestratorConfig(): OrchestratorGraphConfig {
  return {
    agents: [],
    edges: [],
    supervisorModel: BEDROCK_GPT_OSS_120B,
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
  if (!input) return getDefaultOrchestratorConfig();
  const agents = input.agents ?? [];
  const edges = input.edges ?? [];
  const supervisorModel =
    input.supervisorModel?.trim().startsWith("bedrock:")
      ? input.supervisorModel.trim()
      : BEDROCK_GPT_OSS_120B;

  if (!agents.length) {
    return {
      agents: [],
      edges: [],
      supervisorModel,
      deliverableMode: input.deliverableMode,
    };
  }
  return {
    agents: syncRoutesToFromEdges(agents, edges).map((agent) => {
      const enriched = enrichAgentWithSkills(agent);
      const model =
        enriched.model?.trim().startsWith("bedrock:")
          ? enriched.model.trim()
          : suggestModelForRole({
              label: enriched.label,
              role: enriched.role,
              tools: enriched.tools,
            });
      return { ...enriched, model };
    }),
    edges,
    supervisorModel,
    deliverableMode: input.deliverableMode,
  };
}
