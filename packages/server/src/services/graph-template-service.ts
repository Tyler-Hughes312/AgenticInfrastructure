import { desc, eq } from "drizzle-orm";
import {
  getDefaultOrchestratorConfig,
  normalizeOrchestratorConfig,
  type OrchestratorGraphConfig,
} from "../agents/agent-registry.js";
import { getAppDb } from "../db/app-db.js";
import { savedGraphTemplates } from "../db/schema.js";
import { createChatSession, getChatSession, saveChatSessionGraph } from "./chat-session-service.js";
import { getProject } from "./project-service.js";
import { ensureProjectWorkspace } from "./workspace-service.js";

function parseConfig(raw: string): OrchestratorGraphConfig {
  try {
    return normalizeOrchestratorConfig(JSON.parse(raw) as OrchestratorGraphConfig);
  } catch {
    return getDefaultOrchestratorConfig();
  }
}

export type SavedGraphTemplateSummary = {
  id: string;
  name: string;
  description: string;
  agentCount: number;
  sourceSessionId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function listSavedGraphTemplates(): Promise<SavedGraphTemplateSummary[]> {
  const db = getAppDb();
  const rows = await db
    .select()
    .from(savedGraphTemplates)
    .orderBy(desc(savedGraphTemplates.updatedAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    agentCount: Number.parseInt(r.agentCount, 10) || 0,
    sourceSessionId: r.sourceSessionId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export async function getSavedGraphTemplate(id: string) {
  const db = getAppDb();
  const [row] = await db
    .select()
    .from(savedGraphTemplates)
    .where(eq(savedGraphTemplates.id, id))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    config: parseConfig(row.graphConfig),
    agentCount: Number.parseInt(row.agentCount, 10) || 0,
    sourceSessionId: row.sourceSessionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Explicit save — snapshot graph config into the template library. */
export async function saveGraphTemplate(params: {
  name: string;
  description?: string;
  config: OrchestratorGraphConfig;
  sourceSessionId?: string;
}) {
  const normalized = normalizeOrchestratorConfig(params.config);
  if (!normalized.agents.length) {
    throw new Error("Cannot save an empty graph — add agents first");
  }
  const db = getAppDb();
  const [row] = await db
    .insert(savedGraphTemplates)
    .values({
      name: params.name.trim(),
      description: params.description?.trim() ?? "",
      graphConfig: JSON.stringify(normalized),
      sourceSessionId: params.sourceSessionId ?? null,
      agentCount: String(normalized.agents.length),
    })
    .returning();
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    config: normalized,
    agentCount: normalized.agents.length,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function deleteSavedGraphTemplate(id: string): Promise<void> {
  const db = getAppDb();
  await db.delete(savedGraphTemplates).where(eq(savedGraphTemplates.id, id));
}

/** Open saved graph on a project session (graph blueprint + project workspace). */
export async function openTemplateAsNewSession(
  templateId: string,
  projectId: string,
  title?: string
) {
  const template = await getSavedGraphTemplate(templateId);
  if (!template) throw new Error("Saved graph not found");

  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found");

  await ensureProjectWorkspace(project.id, project.repoUrl, project.defaultBranch);

  const sessionTitle = title?.trim() || `${template.name} · ${project.name}`;
  const session = await createChatSession(project.id, sessionTitle, templateId);
  const config = await saveChatSessionGraph(session.id, template.config);
  return {
    sessionId: session.id,
    projectId: project.id,
    title: sessionTitle,
    config,
  };
}

/** Apply saved infrastructure to an existing session (replaces current graph). */
export async function applyTemplateToSession(templateId: string, sessionId: string) {
  const template = await getSavedGraphTemplate(templateId);
  if (!template) throw new Error("Saved infrastructure not found");
  const session = await getChatSession(sessionId);
  if (!session) throw new Error("Chat session not found");

  const config = await saveChatSessionGraph(sessionId, template.config);
  return { sessionId, config, templateName: template.name };
}
