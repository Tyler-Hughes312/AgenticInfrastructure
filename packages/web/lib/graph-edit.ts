import type { OrchestratorGraphConfig } from "./types/orchestrator";

export type GraphEditCommand =
  | { type: "remove"; agentRef: string }
  | { type: "add"; label: string; role?: string }
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

export function parseGraphEditCommand(text: string): GraphEditCommand | null {
  const trimmed = text.trim();

  const remove =
    trimmed.match(
      /^(?:please\s+)?(?:remove|delete|drop|kick)\s+(?:the\s+|agent\s+)?(.+?)(?:\s+from\s+(?:the\s+)?graph)?[.!?]*$/i
    ) ?? trimmed.match(/^\/remove\s+(.+)$/i);
  if (remove) {
    return { type: "remove", agentRef: remove[1].trim() };
  }

  const add =
    trimmed.match(
      /^(?:please\s+)?(?:add|create|include)\s+(?:an?\s+)?(?:agent\s+)?(?:called\s+|named\s+)?["']?([a-z0-9][\w\s-]{0,40})["']?(?:\s+(?:that|who|to)\s+(.+))?[.!?]*$/i
    ) ?? trimmed.match(/^\/add\s+([a-z0-9][\w\s-]{0,40})(?:\s+-\s+(.+))?$/i);
  if (add) {
    return { type: "add", label: add[1].trim(), role: add[2]?.trim() };
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

export function previewGraphEditMessage(
  config: OrchestratorGraphConfig,
  command: GraphEditCommand
): string {
  if (command.type === "remove") {
    const n = normalizeRef(command.agentRef);
    const agent = config.agents.find(
      (a) =>
        a.id === n ||
        normalizeRef(a.label) === n ||
        a.id.replace(/_/g, "") === n.replace(/_/g, "") ||
        normalizeRef(a.label).replace(/_/g, "") === n.replace(/_/g, "")
    );
    if (!agent) return `Looking for agent "${command.agentRef}" to remove…`;
    return `Removing ${agent.label} (${agent.id}) from the graph…`;
  }
  if (command.type === "add") {
    return `Adding agent "${command.label}" to the graph…`;
  }
  if (command.type === "connect") {
    return `Connecting ${command.source} → ${command.target}…`;
  }
  if (command.type === "disconnect") {
    return `Disconnecting ${command.source} → ${command.target}…`;
  }
  if (command.type === "rename") {
    return `Renaming "${command.agentRef}" to "${command.newLabel}"…`;
  }
  if (command.type === "rebuild") {
    return `Rebuilding graph for: "${command.task}"…`;
  }
  return "Updating graph…";
}
