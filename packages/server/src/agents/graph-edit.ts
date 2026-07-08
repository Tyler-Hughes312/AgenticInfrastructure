import type { CustomAgentConfig, GraphEdgeConfig, OrchestratorGraphConfig } from "./agent-registry.js";
import { AVAILABLE_TOOL_NAMES, syncRoutesToFromEdges } from "./agent-registry.js";

export type GraphEditCommand =
  | { type: "remove"; agentRef: string }
  | { type: "add"; label: string; role?: string; tools?: string[] }
  | { type: "connect"; source: string; target: string; label?: string }
  | { type: "disconnect"; source: string; target: string }
  | { type: "rename"; agentRef: string; newLabel: string }
  | { type: "rebuild"; task: string };

function normalizeRef(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[#@]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/** Map "coder 3" / "Coder3" / "coder_3" → agent id on the graph. */
export function resolveAgentRef(
  ref: string,
  agents: CustomAgentConfig[]
): CustomAgentConfig | undefined {
  const n = normalizeRef(ref);
  if (!n) return undefined;

  const byId = agents.find((a) => a.id === n);
  if (byId) return byId;

  const byLabel = agents.find((a) => normalizeRef(a.label) === n);
  if (byLabel) return byLabel;

  // "coder 3" → coder_3 / coder3
  const compact = n.replace(/_/g, "");
  return agents.find(
    (a) => a.id.replace(/_/g, "") === compact || normalizeRef(a.label).replace(/_/g, "") === compact
  );
}

export function parseGraphEditCommand(text: string): GraphEditCommand | null {
  const trimmed = text.trim();

  const remove =
    trimmed.match(
      /^(?:please\s+)?(?:remove|delete|drop|kick)\s+(?:the\s+|agent\s+)?(.+?)(?:\s+from\s+(?:the\s+)?graph)?[.!?]*$/i
    ) ??
    trimmed.match(/^\/remove\s+(.+)$/i);
  if (remove) {
    return { type: "remove", agentRef: remove[1].trim() };
  }

  const add =
    trimmed.match(
      /^(?:please\s+)?(?:add|create|include)\s+(?:an?\s+)?(?:agent\s+)?(?:called\s+|named\s+)?["']?([a-z0-9][\w\s-]{0,40})["']?(?:\s+(?:that|who|to)\s+(.+))?[.!?]*$/i
    ) ?? trimmed.match(/^\/add\s+([a-z0-9][\w\s-]{0,40})(?:\s+-\s+(.+))?$/i);
  if (add) {
    return {
      type: "add",
      label: add[1].trim(),
      role: add[2]?.trim(),
    };
  }

  // connect A → B / wire A into B / connect A to B
  const connect =
    trimmed.match(
      /^(?:connect|wire|link)\s+(.+?)\s+(?:→|->|to|into)\s+(.+?)[.!?]*$/i
    ) ?? trimmed.match(/^\/connect\s+(\S+)\s+(\S+)$/i);
  if (connect) {
    return { type: "connect", source: connect[1].trim(), target: connect[2].trim() };
  }

  // disconnect A → B / unlink A from B
  const disconnect =
    trimmed.match(
      /^(?:disconnect|unlink|remove\s+edge)\s+(.+?)\s+(?:→|->|from)\s+(.+?)[.!?]*$/i
    ) ?? trimmed.match(/^\/disconnect\s+(\S+)\s+(\S+)$/i);
  if (disconnect) {
    return { type: "disconnect", source: disconnect[1].trim(), target: disconnect[2].trim() };
  }

  // rename X to Y / call X Y / relabel X as Y
  const rename =
    trimmed.match(
      /^(?:rename|relabel)\s+(?:the\s+)?(.+?)\s+(?:to|as)\s+["']?(.+?)["']?[.!?]*$/i
    ) ?? trimmed.match(
      /^call\s+(?:the\s+)?(.+?)\s+["']?(.+?)["']?(?:\s+instead)?[.!?]*$/i
    ) ?? trimmed.match(/^\/rename\s+(\S+)\s+(\S+)$/i);
  if (rename) {
    return { type: "rename", agentRef: rename[1].trim(), newLabel: rename[2].trim() };
  }

  // rebuild graph for <task> / redesign pipeline for <task>
  const rebuild =
    trimmed.match(
      /^(?:rebuild|redesign|recreate|replace)\s+(?:the\s+)?(?:graph|pipeline|team|agents?)\s+(?:for\s+)?(.+)[.!?]*$/i
    ) ?? trimmed.match(/^\/rebuild\s+(.+)$/i);
  if (rebuild) {
    return { type: "rebuild", task: rebuild[1].trim() };
  }

  return null;
}

function defaultToolsForLabel(label: string): string[] {
  const l = label.toLowerCase();
  if (/test|qa|quality/.test(l)) {
    return ["shell", "read_file", "edit_file", "git_diff", "manage_memory", "search_memory"];
  }
  if (/architect|design|lead/.test(l)) {
    return ["shell", "read_file", "edit_file", "git_diff", "manage_memory", "search_memory"];
  }
  if (/scrum|product|manager|pm|po/.test(l)) {
    return ["read_file", "manage_memory", "search_memory", "shell"];
  }
  if (/review|publisher|ship/.test(l)) {
    return ["git_diff", "read_file", "git_commit", "git_push", "open_pull_request", "shell", "manage_memory"];
  }
  if (/coder|build|dev|implement|engineer/.test(l)) {
    return [
      "shell",
      "read_file",
      "edit_file",
      "git_diff",
      "git_commit",
      "git_push",
      "manage_memory",
      "search_memory",
    ];
  }
  return [...AVAILABLE_TOOL_NAMES];
}

function skillPrompt(label: string, role: string, tools: string[]): string {
  return (
    `You are ${label}. ${role}\n\n` +
    `## Skills\n` +
    `- Planning: clarify goals, constraints, and done-when checks before heavy work.\n` +
    `- Tool use: prefer these tools — ${tools.join(", ")}.\n` +
    `- Collaboration: leave a short status for the supervisor when finished; do not loop forever.\n` +
    `- Safety: do not invent credentials; use workspace tools for file/shell/git actions.\n\n` +
    `When your assignment is complete, return control to the supervisor.`
  );
}

export function applyGraphEdit(
  config: OrchestratorGraphConfig,
  command: GraphEditCommand
): { config: OrchestratorGraphConfig; message: string } {
  if (command.type === "remove") {
    const agent = resolveAgentRef(command.agentRef, config.agents);
    if (!agent) {
      const known = config.agents.map((a) => a.label).join(", ") || "(none)";
      return {
        config,
        message: `Could not find agent "${command.agentRef}" on the graph. Current agents: ${known}.`,
      };
    }
    const agents = config.agents.filter((a) => a.id !== agent.id);
    const edges = config.edges.filter((e) => e.source !== agent.id && e.target !== agent.id);
    const next = {
      agents: syncRoutesToFromEdges(agents, edges),
      edges,
      supervisorModel: config.supervisorModel,
    };
    return {
      config: next,
      message: `Removed **${agent.label}** (\`${agent.id}\`) from the graph.`,
    };
  }

  if (command.type === "connect") {
    const srcIsSuper = /^supervisor$/i.test(command.source.trim());
    const source = srcIsSuper
      ? { id: "supervisor", label: "supervisor" }
      : resolveAgentRef(command.source, config.agents);
    const target = resolveAgentRef(command.target, config.agents);
    if (!source || !target) {
      const known = config.agents.map((a) => `${a.label} (${a.id})`).join(", ") || "(none)";
      return {
        config,
        message: `Could not resolve agents for connect: "${command.source}" → "${command.target}". Known: ${known}.`,
      };
    }
    const alreadyExists = config.edges.some(
      (e) => e.source === source.id && e.target === target.id
    );
    if (alreadyExists) {
      return { config, message: `Edge **${source.id}** → **${target.id}** already exists.` };
    }
    const edges = [
      ...config.edges,
      { source: source.id, target: target.id, label: command.label ?? "→" },
    ];
    const next: OrchestratorGraphConfig = {
      agents: syncRoutesToFromEdges(config.agents, edges),
      edges,
      supervisorModel: config.supervisorModel,
    };
    return { config: next, message: `Connected **${source.id}** → **${target.id}**.` };
  }

  if (command.type === "disconnect") {
    const srcIsSuper = /^supervisor$/i.test(command.source.trim());
    const source = srcIsSuper
      ? { id: "supervisor", label: "supervisor" }
      : resolveAgentRef(command.source, config.agents);
    const target = resolveAgentRef(command.target, config.agents);
    if (!source || !target) {
      return {
        config,
        message: `Could not resolve agents for disconnect: "${command.source}" → "${command.target}".`,
      };
    }
    const edges = config.edges.filter(
      (e) => !(e.source === source.id && e.target === target.id)
    );
    const next: OrchestratorGraphConfig = {
      agents: syncRoutesToFromEdges(config.agents, edges),
      edges,
      supervisorModel: config.supervisorModel,
    };
    return { config: next, message: `Disconnected **${source.id}** → **${target.id}**.` };
  }

  if (command.type === "rename") {
    const agent = resolveAgentRef(command.agentRef, config.agents);
    if (!agent) {
      const known = config.agents.map((a) => a.label).join(", ") || "(none)";
      return {
        config,
        message: `Could not find agent "${command.agentRef}" to rename. Known: ${known}.`,
      };
    }
    const agents = config.agents.map((a) =>
      a.id === agent.id ? { ...a, label: command.newLabel } : a
    );
    const next: OrchestratorGraphConfig = { ...config, agents };
    return { config: next, message: `Renamed **${agent.label}** → **${command.newLabel}**.` };
  }

  if (command.type === "rebuild") {
    // rebuild is async — callers must handle this type specially (see run-service.ts)
    return { config, message: `Rebuild triggered for: "${command.task}"` };
  }

  // add
  const baseId = normalizeRef(command.label) || "custom_agent";
  let id = baseId;
  let n = 2;
  while (config.agents.some((a) => a.id === id)) {
    id = `${baseId}_${n++}`;
  }
  const tools = command.tools?.length ? command.tools : defaultToolsForLabel(command.label);
  const role =
    command.role?.trim() ||
    `Specialist agent (${command.label}) that helps with the current orchestrator project.`;
  const hasFinal = config.agents.some((a) => a.id === "final_review");
  const agent: CustomAgentConfig = {
    id,
    label: command.label.replace(/\b\w/g, (c) => c.toUpperCase()),
    role,
    prompt: skillPrompt(command.label, role, tools),
    tools,
    routesTo: hasFinal ? ["final_review"] : [],
    launchWhen: [`Supervisor routes work to ${command.label}.`],
    doNotLaunchWhen: [],
    position: { x: 80 + (config.agents.length % 3) * 220, y: 160 + Math.floor(config.agents.length / 3) * 140 },
  };

  const agents = [...config.agents, agent];
  const edges = [
    ...config.edges,
    { source: "supervisor", target: id, label: "route" },
    ...(hasFinal ? [{ source: id, target: "final_review", label: "then" }] : []),
  ];
  const next = {
    agents: syncRoutesToFromEdges(agents, edges),
    edges,
    supervisorModel: config.supervisorModel,
  };
  return {
    config: next,
    message: `Added **${agent.label}** (\`${agent.id}\`) with tools: ${tools.join(", ")}.`,
  };
}
