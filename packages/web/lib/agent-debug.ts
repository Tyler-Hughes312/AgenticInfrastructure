import { CODING_AGENT_NODES } from "./agent-nodes";
import type { RunEvent } from "./types/run";

export type AgentMeta = {
  id: string;
  label: string;
  role: string;
  tools: string[];
  routesTo: string[];
  model?: string;
};

export type ToolCallRecord = {
  id: string;
  tool: string;
  agent: string;
  status: "running" | "done" | "error";
  input?: unknown;
  output?: unknown;
  ts?: number;
};

export type FileChangeRecord = {
  id: string;
  agent: string;
  path?: string;
  content?: string;
  ts?: number;
};

export type GitActivityRecord = {
  id: string;
  agent: string;
  type: "diff" | "commit" | "push" | "create_repo" | "pull_request";
  summary: string;
  detail?: string;
  url?: string;
  ts?: number;
};

export type AgentMetrics = {
  invocations: number;
  toolCalls: number;
  avgLatencyMs: number | null;
  tokens: number;
};

function agentIdSet(knownAgentIds?: string[]): Set<string> {
  if (knownAgentIds?.length) {
    return new Set(knownAgentIds.filter((id) => id !== "supervisor"));
  }
  return new Set<string>(CODING_AGENT_NODES.filter((id) => id !== "supervisor"));
}

export function getEventAgent(e: RunEvent, knownAgentIds?: string[]): string | null {
  const nodeIds = agentIdSet(knownAgentIds);
  const node = e.metadata?.langgraph_node;
  if (typeof node === "string" && nodeIds.has(node)) return node;
  if (e.name && nodeIds.has(e.name)) return e.name;
  // LangGraph worker nodes often appear as chain names matching agent id.
  if (typeof node === "string" && node && node !== "supervisor" && knownAgentIds?.includes(node)) {
    return node;
  }
  return null;
}

export function attributeEventsToAgents(
  events: RunEvent[],
  knownAgentIds?: string[]
): Record<string, RunEvent[]> {
  const byAgent: Record<string, RunEvent[]> = {};
  let currentAgent: string | null = null;
  const stack: string[] = [];

  for (const e of events) {
    const agent = getEventAgent(e, knownAgentIds);

    if (e.event === "on_chain_start" || e.event === "on_node_start") {
      if (agent) {
        stack.push(agent);
        currentAgent = agent;
      }
    }

    const owner = currentAgent ?? agent;
    if (owner) {
      if (!byAgent[owner]) byAgent[owner] = [];
      byAgent[owner].push(e);
    }

    if (e.event === "on_chain_end" || e.event === "on_node_end") {
      if (agent && stack[stack.length - 1] === agent) {
        stack.pop();
        currentAgent = stack[stack.length - 1] ?? null;
      }
    }
  }

  return byAgent;
}

function parseToolInput(data: unknown): unknown {
  const d = data as { input?: { input?: unknown } | unknown; kwargs?: unknown } | undefined;
  const inner = d?.input;
  if (inner && typeof inner === "object" && inner !== null && "input" in inner) {
    return (inner as { input?: unknown }).input;
  }
  return inner ?? d?.kwargs ?? data;
}

function parseToolOutput(data: unknown): unknown {
  const d = data as { output?: { output?: unknown } | unknown } | undefined;
  const inner = d?.output;
  if (inner && typeof inner === "object" && inner !== null && "output" in inner) {
    return (inner as { output?: unknown }).output;
  }
  return inner ?? data;
}

export function extractToolCalls(
  events: RunEvent[],
  agentId?: string,
  knownAgentIds?: string[]
): ToolCallRecord[] {
  const attributed = attributeEventsToAgents(events, knownAgentIds);
  const source = agentId ? attributed[agentId] ?? [] : events;
  const pending = new Map<string, ToolCallRecord>();
  const records: ToolCallRecord[] = [];

  for (const e of source) {
    const agent = getEventAgent(e, knownAgentIds) ?? agentId ?? "unknown";
    const toolName = (e.name ?? "").split(":").pop() ?? e.name ?? "tool";

    if (e.event === "on_tool_start") {
      const id = `${toolName}-${e.ts ?? records.length}`;
      const record: ToolCallRecord = {
        id,
        tool: toolName,
        agent,
        status: "running",
        input: parseToolInput(e.data),
        ts: e.ts,
      };
      pending.set(toolName, record);
      records.push(record);
    }

    if (e.event === "on_tool_end") {
      const record =
        pending.get(toolName) ??
        [...records].reverse().find((r) => r.tool === toolName && r.status === "running");
      if (record) {
        record.status = "done";
        record.output = parseToolOutput(e.data);
        pending.delete(toolName);
      } else {
        records.push({
          id: `${toolName}-end-${e.ts ?? records.length}`,
          tool: toolName,
          agent,
          status: "done",
          output: parseToolOutput(e.data),
          ts: e.ts,
        });
      }
    }
  }

  return records;
}

export function extractFileChanges(
  events: RunEvent[],
  agentId?: string,
  knownAgentIds?: string[]
): FileChangeRecord[] {
  return extractToolCalls(events, agentId, knownAgentIds)
    .filter(
      (t) =>
        t.tool.includes("edit_file") ||
        t.tool.includes("write_file") ||
        t.tool.includes("read_file")
    )
    .map((t) => {
      const input = t.input as Record<string, unknown> | undefined;
      const output = t.output as Record<string, unknown> | undefined;
      return {
        id: t.id,
        agent: t.agent,
        path: (input?.path ?? input?.file_path ?? output?.path) as string | undefined,
        content: (output?.content ?? input?.content ?? output) as string | undefined,
        ts: t.ts,
      };
    })
    .filter((f) => f.path || f.content);
}

export function extractGitActivity(
  events: RunEvent[],
  agentId?: string,
  knownAgentIds?: string[]
): GitActivityRecord[] {
  const tools = extractToolCalls(events, agentId, knownAgentIds);
  const records: GitActivityRecord[] = [];

  for (const t of tools) {
    if (t.tool.includes("git_diff")) {
      records.push({
        id: t.id,
        agent: t.agent,
        type: "diff",
        summary: "Git diff inspected",
        detail: stringifyPreview(t.output),
        ts: t.ts,
      });
    }
    if (t.tool.includes("git_commit")) {
      const input = t.input as Record<string, unknown> | undefined;
      records.push({
        id: t.id,
        agent: t.agent,
        type: "commit",
        summary: `Commit: ${(input?.message as string) ?? "changes committed"}`,
        detail: stringifyPreview(t.output),
        ts: t.ts,
      });
    }
    if (t.tool.includes("git_push")) {
      records.push({
        id: t.id,
        agent: t.agent,
        type: "push",
        summary: "Pushed branch to origin",
        detail: stringifyPreview(t.output),
        ts: t.ts,
      });
    }
    if (t.tool.includes("create_github_repo")) {
      const url = extractUrl(t.output);
      const input = t.input as Record<string, unknown> | undefined;
      records.push({
        id: t.id,
        agent: t.agent,
        type: "create_repo",
        summary: url
          ? `Created repo: ${(input?.name as string) ?? "repository"}`
          : "Creating GitHub repository",
        detail: stringifyPreview(t.output),
        url,
        ts: t.ts,
      });
    }
    if (t.tool.includes("open_pull_request")) {
      const url = extractUrl(t.output);
      records.push({
        id: t.id,
        agent: t.agent,
        type: "pull_request",
        summary: url ? "Pull request opened" : "Opening pull request",
        detail: stringifyPreview(t.output),
        url,
        ts: t.ts,
      });
    }
  }

  return records;
}

export function computeAgentMetrics(
  events: RunEvent[],
  agentId: string,
  knownAgentIds?: string[]
): AgentMetrics {
  const agentEvents = attributeEventsToAgents(events, knownAgentIds)[agentId] ?? [];
  const startTs: Record<string, number> = {};
  const latencies: number[] = [];
  let tokens = 0;
  let invocations = 0;

  for (const e of agentEvents) {
    if (e.event === "on_chain_start") {
      invocations += 1;
      startTs[agentId] = e.ts ?? Date.now();
    }
    if (e.event === "on_chain_end" && startTs[agentId] && e.ts) {
      latencies.push((e.ts - startTs[agentId]) * 1000);
    }
    if (e.event === "on_chat_model_end") {
      const data = e.data as Record<string, unknown> | undefined;
      const output = data?.output as Record<string, unknown> | undefined;
      const chunk = data?.chunk as Record<string, unknown> | undefined;
      const usage =
        output?.usage_metadata ?? chunk?.usage_metadata ?? data?.usage_metadata;
      const usageObj = usage as { total_tokens?: number } | undefined;
      if (usageObj?.total_tokens) tokens += usageObj.total_tokens;
    }
  }

  const toolCalls = extractToolCalls(agentEvents, agentId, knownAgentIds).length;
  const avgLatencyMs =
    latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;

  return { invocations, toolCalls, avgLatencyMs, tokens };
}

export function getAgentNodeState(
  events: RunEvent[],
  agentId: string,
  knownAgentIds?: string[]
): "idle" | "running" | "done" {
  const agentEvents = events.filter((e) => getEventAgent(e, knownAgentIds) === agentId);
  if (!agentEvents.length) return "idle";

  let active = false;
  let completed = false;
  for (const e of agentEvents) {
    if (e.event === "on_chain_start" || e.event === "on_node_start") active = true;
    if (e.event === "on_chain_end" || e.event === "on_node_end") {
      active = false;
      completed = true;
    }
  }
  if (active) return "running";
  if (completed) return "done";
  return "idle";
}

function stringifyPreview(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.slice(0, 4000);
  try {
    return JSON.stringify(value, null, 2).slice(0, 4000);
  } catch {
    return String(value);
  }
}

function extractUrl(value: unknown): string | undefined {
  if (typeof value === "string" && value.startsWith("http")) return value;
  const text = stringifyPreview(value);
  const match = text.match(/https?:\/\/[^\s"']+/);
  return match?.[0];
}
