import { eq, desc } from "drizzle-orm";
import { getAppDb } from "../db/app-db.js";
import { chatSessions, chatMessages, runs } from "../db/schema.js";
import {
  getDefaultOrchestratorConfig,
  normalizeOrchestratorConfig,
  type OrchestratorGraphConfig,
} from "../agents/agent-registry.js";
import {
  deleteSessionFileChanges,
  deleteSessionWorkspace,
} from "./workspace-service.js";

function parseGraphConfig(raw: string): OrchestratorGraphConfig {
  try {
    return normalizeOrchestratorConfig(JSON.parse(raw) as OrchestratorGraphConfig);
  } catch {
    return getDefaultOrchestratorConfig();
  }
}

export async function createChatSession(
  projectId?: string,
  title?: string,
  graphTemplateId?: string
) {
  const db = getAppDb();
  const blank = getDefaultOrchestratorConfig();
  const [row] = await db
    .insert(chatSessions)
    .values({
      projectId: projectId ?? null,
      graphTemplateId: graphTemplateId ?? null,
      title: title ?? null,
      graphConfig: JSON.stringify(blank),
    })
    .returning();
  return row;
}

export async function getChatSession(sessionId: string) {
  const db = getAppDb();
  const [row] = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.id, sessionId))
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    graphConfig: parseGraphConfig(row.graphConfig),
  };
}

export async function getChatSessionGraph(sessionId: string): Promise<OrchestratorGraphConfig> {
  const session = await getChatSession(sessionId);
  return session?.graphConfig ?? getDefaultOrchestratorConfig();
}

export async function saveChatSessionGraph(
  sessionId: string,
  config: OrchestratorGraphConfig
): Promise<OrchestratorGraphConfig> {
  const normalized = normalizeOrchestratorConfig(config);
  const db = getAppDb();
  await db
    .update(chatSessions)
    .set({
      graphConfig: JSON.stringify(normalized),
      updatedAt: new Date(),
    })
    .where(eq(chatSessions.id, sessionId));
  return normalized;
}

export async function appendChatMessage(
  sessionId: string,
  role: "user" | "assistant" | "status",
  content: string,
  runId?: string
) {
  const db = getAppDb();
  if (role === "user") {
    const [session] = await db
      .select({ title: chatSessions.title })
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1);
    if (session && !session.title?.trim()) {
      const autoTitle = content.trim().slice(0, 80) || "Untitled structure";
      await db
        .update(chatSessions)
        .set({ title: autoTitle, updatedAt: new Date() })
        .where(eq(chatSessions.id, sessionId));
    }
  }
  const [row] = await db
    .insert(chatMessages)
    .values({
      sessionId,
      role,
      content,
      runId: runId ?? null,
    })
    .returning();
  await db
    .update(chatSessions)
    .set({ updatedAt: new Date() })
    .where(eq(chatSessions.id, sessionId));
  return row;
}

export async function listChatMessages(sessionId: string) {
  const db = getAppDb();
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(chatMessages.createdAt);
}

export async function listChatSessions(limit = 50) {
  const db = getAppDb();
  return db
    .select()
    .from(chatSessions)
    .orderBy(desc(chatSessions.updatedAt))
    .limit(limit);
}

export async function updateChatSessionTitle(sessionId: string, title: string) {
  const db = getAppDb();
  await db
    .update(chatSessions)
    .set({ title, updatedAt: new Date() })
    .where(eq(chatSessions.id, sessionId));
}

export type ChatSessionSummary = {
  id: string;
  projectId: string | null;
  title: string | null;
  graphConfig: OrchestratorGraphConfig;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
  agentCount: number;
};

export async function listChatSessionsDetailed(limit = 100): Promise<ChatSessionSummary[]> {
  const sessions = await listChatSessions(limit);
  const summaries: ChatSessionSummary[] = [];
  for (const s of sessions) {
    const messages = await listChatMessages(s.id);
    const graphConfig = parseGraphConfig(s.graphConfig);
    summaries.push({
      id: s.id,
      projectId: s.projectId,
      title: s.title,
      graphConfig,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messageCount: messages.length,
      agentCount: graphConfig.agents.length,
    });
  }
  return summaries;
}

export async function duplicateChatSession(sourceId: string, title?: string) {
  const source = await getChatSession(sourceId);
  if (!source) throw new Error("Chat session not found");
  const messages = await listChatMessages(sourceId);
  const db = getAppDb();
  const baseTitle = source.title?.trim() || "Untitled structure";
  const [row] = await db
    .insert(chatSessions)
    .values({
      projectId: source.projectId,
      title: title?.trim() || `${baseTitle} (copy)`,
      graphConfig: JSON.stringify(source.graphConfig),
    })
    .returning();
  for (const m of messages) {
    await db.insert(chatMessages).values({
      sessionId: row.id,
      role: m.role,
      content: m.content,
      runId: null,
    });
  }
  return row;
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  const db = getAppDb();
  await deleteSessionFileChanges(sessionId);
  deleteSessionWorkspace(sessionId);
  await db.delete(chatMessages).where(eq(chatMessages.sessionId, sessionId));
  await db.update(runs).set({ chatSessionId: null }).where(eq(runs.chatSessionId, sessionId));
  await db.delete(chatSessions).where(eq(chatSessions.id, sessionId));
}
