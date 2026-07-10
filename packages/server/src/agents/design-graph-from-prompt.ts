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
import type { GraphEditCommand } from "./graph-edit.js";
import { applyGraphEdit } from "./graph-edit.js";
import { inferToolsFromSkills, mergeAgentTools, normalizeSkillIds, getSkillCatalogForApi, enrichAgentWithSkills } from "./skill-catalog.js";
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
  finalDeliverable: string,
  upstreamAgents: string[]
): string {
  const skills = agent.skills.map((s) => `- ${s}`).join("\n");
  const upstream =
    upstreamAgents.length > 0
      ? upstreamAgents.join(", ")
      : "(none — you may be first in the pipeline)";
  const roleBlob = `${agent.label} ${agent.role} ${agent.produces}`.toLowerCase();
  const isPlanner =
    /\b(plan|planner|pm|product|architect|design)\b/.test(roleBlob) &&
    !/\b(implement|build|code|develop|engineer)\b/.test(roleBlob);
  const isImplementer =
    /\b(implement|build|code|develop|engineer|frontend|backend|full.?stack|dev)\b/.test(roleBlob) ||
    agent.tools.some((t) => t === "write_file" || t === "edit_file");
  const implementationRules = isImplementer
    ? `## Implementation requirements (mandatory)\n` +
      `- You MUST persist real artifacts with \`write_file\` / \`edit_file\` — not just describe them in handoff text.\n` +
      `- For software tasks: create working source files under \`src/\` (and config files as needed).\n` +
      `- List every file path you wrote in your \`publish_handoff\` payload.\n` +
      `- Do not call \`publish_handoff\` until files exist on disk.\n\n`
    : "";
  const planningRules = isPlanner
    ? `## Planning scope\n` +
      `- Produce specs/plans for downstream agents — do NOT write production code yourself.\n` +
      `- Your handoff must be detailed enough for implementers to build without guessing.\n\n`
    : "";
  return (
    `You are ${agent.label} (\`${agent.id}\`).\n` +
    `${agent.role}\n\n` +
    `## Data contract\n` +
    `- Consumes: ${agent.consumes}\n` +
    `- Produces: ${agent.produces}\n` +
    `- Upstream agents: ${upstream}\n\n` +
    `## Skills (auto-assigned for this role)\n${skills}\n\n` +
    `## Tools\n${agent.tools.join(", ")}\n\n` +
    planningRules +
    implementationRules +
    `## Pipeline handoff protocol (mandatory)\n` +
    `1. FIRST: call \`read_pipeline_context\` to load upstream handoffs.\n` +
    `2. Do your work using the skills and tools above.\n` +
    `3. LAST: call \`publish_handoff\` with artifact_type matching what you produce ` +
    `(e.g. "${agent.produces.slice(0, 40)}") and the FULL payload downstream agents need.\n` +
    `4. Do not finish until publish_handoff succeeds.\n\n` +
    `## Workspace deliverables\n` +
    `Persist user-facing artifacts to the session workspace:\n` +
    `- Essays, reports, specs → \`docs/\` or \`output/\` via \`write_document\` (.md, .txt, .html, .docx)\n` +
    `- Code → \`src/\` or project paths via \`write_file\` / \`edit_file\`\n` +
    `- Data exports → \`output/\` (.json, .csv)\n` +
    `The user can open, edit, and download files from the Code IDE.\n\n` +
    `## Git / GitHub\n` +
    `- Local git is initialized in the workspace. If no GitHub remote exists, call \`create_github_repo\` before \`git_push\`.\n` +
    `- Never tell the user to create repositories manually on github.com.\n\n` +
    `Overall user deliverable: ${finalDeliverable}\n` +
    `If you are the terminal agent, include the user-facing answer in your handoff payload.`
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

function upstreamAgentIds(agentId: string, edges: GraphEdgeConfig[]): string[] {
  return edges.filter((e) => e.target === agentId && e.source !== "supervisor").map((e) => e.source);
}

function toOrchestratorConfig(
  designed: z.infer<typeof designedGraphSchema>
): OrchestratorGraphConfig {
  const edgeList = designed.edges.map((e) => ({
    source: e.source,
    target: e.target,
    label: e.label,
  }));

  const stubs: CustomAgentConfig[] = designed.agents.map((a, i) => ({
    id: a.id,
    label: a.label,
    role: a.role,
    tools: [],
    routesTo: [],
    position: layoutPositions(designed.agents.length, i),
  }));

  const idSet = new Set(stubs.map((a) => a.id));
  const entry = designed.entry_agents.filter((id) => idSet.has(id));
  const edges = ensureDataFlow(stubs, edgeList, entry.length ? entry : [stubs[0].id]);

  const agents: CustomAgentConfig[] = designed.agents.map((a, i) => {
    const skillIds = normalizeSkillIds(a.skills);
    const inferred = inferToolsFromSkills(skillIds.length ? skillIds : a.skills, a.role, a.consumes, a.produces);
    const tools = mergeAgentTools(a.tools, inferred);
    const stub: CustomAgentConfig = {
      id: a.id,
      label: a.label,
      role: a.role,
      skills: skillIds.length ? skillIds : normalizeSkillIds(a.skills),
      consumes: a.consumes,
      produces: a.produces,
      prompt: enrichPrompt(a, designed.final_deliverable, upstreamAgentIds(a.id, edges)),
      tools,
      routesTo: [],
      launchWhen: [`Work matching: ${a.consumes}`],
      doNotLaunchWhen: [],
      position: layoutPositions(designed.agents.length, i),
    };
    return enrichAgentWithSkills(stub);
  });

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

const SKILL_ID_LIST = getSkillCatalogForApi()
  .map((s) => `${s.id} (${s.label})`)
  .join(", ");

const SYSTEM = `You design multi-agent orchestration graphs dynamically from the user's prompt.
Do NOT use canned pipelines or fixed role templates. Invent agents, skills, tools, and edges that fit THIS specific request at runtime.

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
- 2–10 agents (scale team size to the request; use more agents when roles or parallel workstreams are named).
- tools ⊆ { ${AVAILABLE_TOOL_NAMES.join(", ")} }
- Always include publish_handoff and read_pipeline_context (added automatically if omitted).
- skills: pick 2–6 skill IDs per agent from this catalog: ${SKILL_ID_LIST}
  Non-dedicated agents may include optional skills (e.g. a builder may add "testing" or "debugging").
- edges are DATA FLOW with meaningful labels (research notes, outline, draft essay, critique, final essay, etc.).
- source is "supervisor" or an agent id; target is an agent id.
- entry_agents: who supervisor starts (support parallel entries when asked).
- Software / agentic teams: infer roles from the user (scrum, architect, planner, dev, tester, reviewer, production, etc.) — do not copy a fixed template; match their wording.
- If the user asks for parallel developers/coders/builders, create MULTIPLE distinct agents (e.g. developer_1, developer_2, developer_3) with upstream fan-out edges labeled "parallel slice" — never collapse parallel work into one Developer node.
- When refining an existing graph, apply the requested change (e.g. split one developer into parallel devs) while preserving unrelated agents unless the user asked to replace the team.
- Each agent consumes specific upstream artifacts and produces a named artifact for downstream agents.
- Always include a terminal agent that produces the final_deliverable for chat.
- If the user wants GitHub push/PR, include an agent with git_push / open_pull_request and skills github_publish, git_workflow.
- If the user wants a NEW GitHub repository created, include create_github_repo on a publisher/devops agent.
- Coding agents should include implementation skill; add debugging and testing when appropriate.
- Writing/report agents should use write_document and save files under docs/ or output/.
- If the user wants a chat essay/report/answer, final_deliverable must say that explicitly.`;

function extractModelText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === "string" ? c : (c as { text?: string }).text ?? ""))
      .join("");
  }
  return String(content ?? "");
}

async function invokeGraphDesigner(
  task: string,
  repoHint: string | undefined,
  existing: OrchestratorGraphConfig | null | undefined,
  retryHint?: string
): Promise<{ config: OrchestratorGraphConfig; summary: string }> {
  const model = getModel(false);
  const repoLine = repoHint?.trim()
    ? `Optional repo context: ${repoHint.trim()}`
    : "No git repo is required unless the prompt asks for push/PR.";

  const existingLine = existing?.agents?.length
    ? `\nExisting canvas agents (keep and connect unless the user asks to replace or remove):\n${existing.agents
        .map((a) => `- ${a.id} (${a.label}): ${a.role.slice(0, 100)}`)
        .join("\n")}\nExisting edges:\n${existing.edges
        .map((e) => `- ${e.source} → ${e.target}${e.label ? ` (${e.label})` : ""}`)
        .join("\n")}\nRefine or extend this graph per the user request.\n`
    : "";

  const action = existing?.agents?.length
    ? "Update the agent graph for this prompt"
    : "Design a fresh agent graph for this prompt";

  const reply = await model.invoke([
    new SystemMessage(SYSTEM),
    new HumanMessage(
      `${repoLine}${existingLine}${retryHint ? `\n${retryHint}\n` : ""}\n\nUser prompt:\n"""${task}"""\n\n${action}. JSON only.`
    ),
  ]);

  const parsed = designedGraphSchema.parse(extractJsonObject(extractModelText(reply.content)));
  const config = toOrchestratorConfig(parsed);
  if (!config.agents.length) throw new Error("Empty agent graph from model");
  return { config, summary: parsed.summary };
}

export async function designGraphFromPrompt(
  task: string,
  repoHint?: string,
  existing?: OrchestratorGraphConfig | null
): Promise<{ config: OrchestratorGraphConfig; summary: string; source: "llm" }> {
  try {
    const result = await invokeGraphDesigner(task, repoHint, existing);
    return { ...result, source: "llm" };
  } catch (firstErr) {
    console.warn("LLM graph design failed; retrying once:", firstErr);
    try {
      const result = await invokeGraphDesigner(
        task,
        repoHint,
        existing,
        "Your previous response was invalid or incomplete. Return ONLY valid JSON matching the schema."
      );
      return { ...result, source: "llm" };
    } catch (retryErr) {
      const detail = retryErr instanceof Error ? retryErr.message : String(retryErr);
      throw new Error(
        `Could not design agent graph from your request: ${detail}. Try rephrasing the team roles and parallel structure.`
      );
    }
  }
}

/** True when a graph edit should be resolved by the LLM (not deterministic canvas surgery). */
export function isLlmGraphEdit(command: GraphEditCommand): boolean {
  return command.type === "rebuild" || command.type === "refine" || command.type === "add";
}

/** Apply a graph edit — LLM-driven for team/subsystem changes, deterministic for connect/disconnect/rename/remove. */
export async function applyGraphChangeFromCommand(
  command: GraphEditCommand | null,
  description: string,
  existing: OrchestratorGraphConfig,
  repoUrl: string
): Promise<{ config: OrchestratorGraphConfig; message: string }> {
  const repoHint = repoHintFromTask(description || existing.agents[0]?.role || "", repoUrl);

  if (command?.type === "rebuild") {
    const { config, summary } = await designGraphFromPrompt(command.task, repoHintFromTask(command.task, repoUrl), null);
    return { config, message: `Graph rebuilt: ${summary}` };
  }

  if (command?.type === "refine") {
    const { config, summary } = await designGraphFromPrompt(command.task, repoHintFromTask(command.task, repoUrl), existing);
    return { config, message: `Graph updated: ${summary}` };
  }

  if (command?.type === "add") {
    const addTask =
      `Add an agent called "${command.label}"` +
      `${command.role ? ` with role: ${command.role}` : ""}. ` +
      `Keep existing agents unless the request implies replacing the team.`;
    const { config, summary } = await designGraphFromPrompt(addTask, repoHint, existing);
    return { config, message: `Graph updated: ${summary}` };
  }

  if (!command && description.trim()) {
    const { config, summary } = await designGraphFromPrompt(description, repoHint, existing);
    return { config, message: `Graph updated: ${summary}` };
  }

  if (command) {
    return applyGraphEdit(existing, command);
  }

  throw new Error("No graph change to apply");
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
