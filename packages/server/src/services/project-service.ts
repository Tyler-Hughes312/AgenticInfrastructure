import { desc, eq } from "drizzle-orm";
import { env } from "../config.js";
import { getAppDb } from "../db/app-db.js";
import { chatSessions, projects } from "../db/schema.js";
import { LOCAL_WORKSPACE_REPO } from "../tools/git-ops.js";
import { createChatSession } from "./chat-session-service.js";
import { deleteProjectWorkspace, ensureProjectWorkspace } from "./workspace-service.js";

export type ProjectSourceType = "github" | "local";

export function normalizeRepoInput(input: string): {
  repoUrl: string;
  sourceType: ProjectSourceType;
  displayName?: string;
} {
  const raw = input.trim();
  if (!raw || raw === "local" || raw.startsWith("local://")) {
    return { repoUrl: LOCAL_WORKSPACE_REPO, sourceType: "local" };
  }

  let url = raw;
  if (!url.includes("://")) {
    if (url.startsWith("github.com/")) url = `https://${url}`;
    else if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`;
    else throw new Error("Invalid repo URL. Use https://github.com/owner/repo or owner/repo");
  }
  if (!url.startsWith("http")) {
    throw new Error("Invalid repo URL. Use https://github.com/owner/repo");
  }

  url = url.replace(/\.git\/?$/, "");
  const githubMatch = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\/.*)?$/);
  if (githubMatch) {
    const [, owner, repo] = githubMatch;
    const cloneUrl = `https://github.com/${owner}/${repo}.git`;
    return { repoUrl: cloneUrl, sourceType: "github", displayName: `${owner}/${repo}` };
  }

  const cloneUrl = url.endsWith(".git") ? url : `${url}.git`;
  return { repoUrl: cloneUrl, sourceType: "github" };
}

export async function createProject(params: {
  name?: string;
  repo_url: string;
  default_branch?: string;
}) {
  const normalized = normalizeRepoInput(params.repo_url);
  const name =
    params.name?.trim() || normalized.displayName || env.DEFAULT_PROJECT_NAME;
  const db = getAppDb();
  const [row] = await db
    .insert(projects)
    .values({
      name,
      repoUrl: normalized.repoUrl,
      sourceType: normalized.sourceType,
      defaultBranch: params.default_branch?.trim() || "main",
    })
    .returning();
  return row;
}

export async function getProject(id: string) {
  const db = getAppDb();
  const [row] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return row ?? null;
}

export async function listProjects() {
  const db = getAppDb();
  return db.select().from(projects).orderBy(desc(projects.createdAt));
}

export async function deleteProject(id: string): Promise<void> {
  const db = getAppDb();
  const sessions = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(eq(chatSessions.projectId, id));
  if (sessions.length > 0) {
    throw new Error("Cannot delete project with active sessions — delete sessions first");
  }
  deleteProjectWorkspace(id);
  await db.delete(projects).where(eq(projects.id, id));
}

/** Clone or init workspace and start a new chat session on this project. */
export async function openProject(projectId: string, title?: string) {
  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found");

  await ensureProjectWorkspace(project.id, project.repoUrl, project.defaultBranch);
  const sessionTitle = title?.trim() || project.name;
  const session = await createChatSession(project.id, sessionTitle);
  return { project, session };
}
