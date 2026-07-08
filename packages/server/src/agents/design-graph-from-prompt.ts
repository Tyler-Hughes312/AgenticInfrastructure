import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import {
  AVAILABLE_TOOL_NAMES,
  normalizeOrchestratorConfig,
  syncRoutesToFromEdges,
  type CustomAgentConfig,
  type GraphEdgeConfig,
  type OrchestratorGraphConfig,
  type ToolName,
} from "./agent-registry.js";
import { getModel } from "../models-llm.js";
import { extractRepoHint, isSoftwareDevTask } from "./software-dev-pipeline.js";
import { isAgentTeamDesignTask } from "./agent-team-pipeline.js";
import { isRemoteRepo } from "../tools/git-ops.js";

const toolSet = new Set<string>(AVAILABLE_TOOL_NAMES);

const designedAgentSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: z.string().min(1).max(60),
  role: z.string().min(1).max(400),
  produces: z.string().min(1).max(240),
  consumes: z.string().min(1).max(240),
  tools: z
    .array(z.string())
    .min(1)
    .max(12)
    .transform((tools) => {
      const cleaned = tools.filter((t): t is ToolName => toolSet.has(t));
      return cleaned.length
        ? cleaned
        : (["read_file", "manage_memory", "search_memory"] as ToolName[]);
    }),
  skills: z.array(z.string().min(1).max(200)).min(1).max(6),
});

const designedEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  label: z.string().min(1).max(80),
});

const deliverableModeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("chat") }),
  z.object({ type: z.literal("github"), pr: z.boolean().optional() }),
  z.object({ type: z.literal("both"), pr: z.boolean().optional() }),
]);

const designedGraphSchema = z.object({
  summary: z.string().min(1).max(500),
  final_deliverable: z
    .string()
    .min(1)
    .max(240)
    .describe("What the user should receive in chat when the pipeline finishes"),
  deliverable_mode: deliverableModeSchema.default({ type: "chat" }),
  agents: z.array(designedAgentSchema).min(1).max(10),
  edges: z.array(designedEdgeSchema).min(1).max(40),
  entry_agents: z.array(z.string()).min(1),
});

function layoutPositions(count: number, index: number): { x: number; y: number } {
  const cols = Math.min(3, Math.max(1, count));
  const col = index % cols;
  const row = Math.floor(index / cols);
  return { x: 60 + col * 240, y: 140 + row * 150 };
}

function enrichPrompt(
  agent: z.infer<typeof designedAgentSchema>,
  finalDeliverable: string
): string {
  const skills = agent.skills.map((s) => `- ${s}`).join("\n");
  return (
    `You are ${agent.label} (\`${agent.id}\`).\n` +
    `${agent.role}\n\n` +
    `## Data contract\n` +
    `- Consumes: ${agent.consumes}\n` +
    `- Produces: ${agent.produces}\n\n` +
    `## Skills\n${skills}\n\n` +
    `## Tools\n${agent.tools.join(", ")}\n\n` +
    `Overall user deliverable for this run: ${finalDeliverable}\n` +
    `Pass your produce-payload clearly so downstream agents can use it. ` +
    `If you are the terminal/integrator agent, include the full user-facing answer in your final message. ` +
    `When done, stop and return control. Do not loop endlessly.`
  );
}

function ensureDataFlow(
  agents: CustomAgentConfig[],
  edges: GraphEdgeConfig[],
  entryAgents: string[]
): GraphEdgeConfig[] {
  const ids = new Set(agents.map((a) => a.id));
  let next = edges.filter(
    (e) =>
      (e.source === "supervisor" || ids.has(e.source)) &&
      ids.has(e.target) &&
      e.source !== e.target
  );

  for (const entry of entryAgents) {
    if (!ids.has(entry)) continue;
    if (!next.some((e) => e.source === "supervisor" && e.target === entry)) {
      next.push({ source: "supervisor", target: entry, label: "kickoff / brief" });
    }
  }

  if (!next.some((e) => e.source === "supervisor") && agents[0]) {
    next.push({ source: "supervisor", target: agents[0].id, label: "kickoff / brief" });
  }

  for (const agent of agents) {
    const inbound = next.filter((e) => e.target === agent.id);
    if (inbound.length) continue;
    const donor =
      entryAgents.find((id) => id !== agent.id && ids.has(id)) ??
      agents.find((a) => a.id !== agent.id)?.id;
    if (donor) {
      next.push({ source: donor, target: agent.id, label: "handoff" });
    } else if (!next.some((e) => e.source === "supervisor" && e.target === agent.id)) {
      next.push({ source: "supervisor", target: agent.id, label: "kickoff / brief" });
    }
  }

  const seen = new Set<string>();
  next = next.filter((e) => {
    const key = `${e.source}->${e.target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return next;
}

function toOrchestratorConfig(
  designed: z.infer<typeof designedGraphSchema>
): OrchestratorGraphConfig {
  const agents: CustomAgentConfig[] = designed.agents.map((a, i) => ({
    id: a.id,
    label: a.label,
    role: a.role,
    prompt: enrichPrompt(a, designed.final_deliverable),
    tools: a.tools,
    routesTo: [],
    launchWhen: [`Work matching: ${a.consumes}`],
    doNotLaunchWhen: [],
    position: layoutPositions(designed.agents.length, i),
  }));

  const idSet = new Set(agents.map((a) => a.id));
  const entry = designed.entry_agents.filter((id) => idSet.has(id));
  const edges = ensureDataFlow(
    agents,
    designed.edges.map((e) => ({
      source: e.source,
      target: e.target,
      label: e.label,
    })),
    entry.length ? entry : [agents[0].id]
  );

  return normalizeOrchestratorConfig({
    agents: syncRoutesToFromEdges(agents, edges),
    edges,
    deliverableMode: designed.deliverable_mode,
  });
}

function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object in model response");
  return JSON.parse(raw.slice(start, end + 1));
}

function minimalFallbackGraph(task: string): OrchestratorGraphConfig {
  // Last-resort single synthesizer — still prompt-derived role, not a canned multi-stage template.
  const wantsGit = /\b(git|github|pr|pull request|push|repo)\b/i.test(task);
  const tools: ToolName[] = wantsGit
    ? [
        "shell",
        "read_file",
        "edit_file",
        "git_diff",
        "git_commit",
        "git_push",
        "open_pull_request",
        "manage_memory",
        "search_memory",
      ]
    : ["shell", "read_file", "edit_file", "manage_memory", "search_memory"];

  const agent: CustomAgentConfig = {
    id: "lead_agent",
    label: "Lead Agent",
    role: `Handles the user request end-to-end: ${task.slice(0, 180)}`,
    prompt:
      `You are Lead Agent. Complete this user request fully and return the final answer in chat.\n` +
      `Request:\n${task}\n\n` +
      `## Tools\n${tools.join(", ")}\n` +
      `If GitHub push/PR is requested and credentials/repo exist, do that. Always end with the user-facing answer.`,
    tools,
    routesTo: [],
    launchWhen: ["Any user task requiring work."],
    doNotLaunchWhen: [],
    position: { x: 220, y: 200 },
  };
  const edges: GraphEdgeConfig[] = [
    { source: "supervisor", target: "lead_agent", label: "full request" },
  ];
  return normalizeOrchestratorConfig({ agents: [agent], edges });
}

const SYSTEM = `You design multi-agent orchestration graphs dynamically from the user's prompt.
Do NOT use canned pipelines. Invent agents/skills/tools/edges that fit THIS request.

Return ONLY JSON:
{
  "summary": string,
  "final_deliverable": string,
  "deliverable_mode": { "type": "chat" } | { "type": "github", "pr": true|false } | { "type": "both", "pr": true|false },
  "agents": [{
    "id": "snake_case",
    "label": string,
    "role": string,
    "consumes": string,
    "produces": string,
    "tools": string[],
    "skills": string[]
  }],
  "edges": [{ "source": string, "target": string, "label": string }],
  "entry_agents": string[]
}

Rules:
- deliverable_mode: "chat" if the user wants an answer/essay/report in chat.
  "github" if they want code committed and pushed (pr:true if PR requested).
  "both" if they want a GitHub push AND a chat summary.
- 2–8 agents max (1 is OK for tiny tasks).
- tools ⊆ { ${AVAILABLE_TOOL_NAMES.join(", ")} }
- edges are DATA FLOW with meaningful labels (research notes, outline, draft essay, critique, final essay, etc.).
- source is "supervisor" or an agent id; target is an agent id.
- entry_agents: who supervisor starts (support parallel entries when asked).
- Always include a terminal agent that produces the final_deliverable for chat.
- If the user wants GitHub push/PR, include an agent with git_push / open_pull_request.
- If the user wants a chat essay/report/answer, final_deliverable must say that explicitly.`;

export async function designGraphFromPrompt(
  task: string,
  repoHint?: string
): Promise<{ config: OrchestratorGraphConfig; summary: string; source: "llm" | "fallback" }> {
  const model = getModel(false);
  const repoLine = repoHint?.trim()
    ? `Optional repo context: ${repoHint.trim()}`
    : "No git repo is required unless the prompt asks for push/PR.";

  try {
    const reply = await model.invoke([
      new SystemMessage(SYSTEM),
      new HumanMessage(
        `${repoLine}\n\nUser prompt:\n"""${task}"""\n\nDesign a fresh agent graph for this prompt. JSON only.`
      ),
    ]);
    const content =
      typeof reply.content === "string"
        ? reply.content
        : Array.isArray(reply.content)
          ? reply.content
              .map((c) => (typeof c === "string" ? c : (c as { text?: string }).text ?? ""))
              .join("")
          : String(reply.content ?? "");

    const parsed = designedGraphSchema.parse(extractJsonObject(content));
    const config = toOrchestratorConfig(parsed);
    if (!config.agents.length) throw new Error("Empty agent graph from model");
    return { config, summary: parsed.summary, source: "llm" };
  } catch (err) {
    console.warn("LLM graph design failed; using minimal prompt-derived fallback:", err);
    return {
      config: minimalFallbackGraph(task),
      summary: "Minimal single-agent fallback (LLM design failed)",
      source: "fallback",
    };
  }
}

export function shouldDesignGraphForTask(
  task: string,
  blank: boolean,
  agentCount: number
): boolean {
  const t = task.trim();
  if (!t) return false;
  if (
    /\b(rebuild|redesign|recreate|replace)\b.*\b(agent|graph|team|pipeline)\b/i.test(t) ||
    /\b(new|different)\b.*\b(agent team|pipeline|graph)\b/i.test(t)
  ) {
    return true;
  }
  if (blank) {
    return (
      isAgentTeamDesignTask(t) ||
      isSoftwareDevTask(t) ||
      t.length > 40 ||
      /\b(make|build|create|implement|agent|workflow|pipeline|research|essay|write|analyze)\b/i.test(
        t
      )
    );
  }
  return isAgentTeamDesignTask(t);
}

export function repoHintFromTask(task: string, repoUrl: string): string | undefined {
  return extractRepoHint(task) || (isRemoteRepo(repoUrl) ? repoUrl : undefined);
}

/** After a pipeline finishes, synthesize a clean user-facing chat answer when needed. */
export async function synthesizeFinalChatAnswer(
  task: string,
  pipelineNotes: string
): Promise<string> {
  const model = getModel(false);
  const reply = await model.invoke([
    new SystemMessage(
      "You produce the final user-facing chat response after a multi-agent run. " +
        "Use the pipeline notes. Honor length/format constraints from the original request. " +
        "If notes already contain a suitable final answer, return that polished answer only. " +
        "Do not mention agents or tooling unless asked."
    ),
    new HumanMessage(
      `Original request:\n${task}\n\nPipeline notes:\n${pipelineNotes.slice(0, 12000)}\n\nFinal chat response:`
    ),
  ]);
  const content =
    typeof reply.content === "string"
      ? reply.content
      : Array.isArray(reply.content)
        ? reply.content
            .map((c) => (typeof c === "string" ? c : (c as { text?: string }).text ?? ""))
            .join("")
        : String(reply.content ?? "");
  return content.trim();
}
