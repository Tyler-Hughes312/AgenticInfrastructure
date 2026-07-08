export type ParsedOrchestratorMessage = {
  task: string;
  targetAgent?: string;
};

const AGENT_ID_RE = /^[a-z][a-z0-9_]*$/;

export function parseOrchestratorMessage(
  text: string,
  agentIds: string[]
): ParsedOrchestratorMessage {
  const trimmed = text.trim();
  const ids = new Set(agentIds.filter((id) => id !== "supervisor"));

  const atInline = trimmed.match(/@([a-z][a-z0-9_]*)\b/i);
  if (atInline) {
    const agentId = atInline[1].toLowerCase();
    if (ids.has(agentId) && AGENT_ID_RE.test(agentId)) {
      const task = trimmed.replace(new RegExp(`@${agentId}\\b`, "i"), "").trim();
      if (task) return { task, targetAgent: agentId };
    }
  }

  const launchMatch = trimmed.match(/^\/launch\s+([a-z][a-z0-9_]*)\s+([\s\S]+)$/i);
  if (launchMatch) {
    const agentId = launchMatch[1].toLowerCase();
    if (ids.has(agentId)) {
      return { task: launchMatch[2].trim(), targetAgent: agentId };
    }
  }

  const atPrefix = trimmed.match(/^@([a-z][a-z0-9_]*)\s+([\s\S]+)$/i);
  if (atPrefix) {
    const agentId = atPrefix[1].toLowerCase();
    if (ids.has(agentId)) {
      return { task: atPrefix[2].trim(), targetAgent: agentId };
    }
  }

  return { task: trimmed };
}
