import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  cpSync,
} from "node:fs";
import { join, relative, dirname } from "node:path";
import { PassThrough } from "node:stream";
import { ZipArchive } from "archiver";
import { eq, desc } from "drizzle-orm";
import { env } from "../config.js";
import { getAppDb } from "../db/app-db.js";
import { chatSessions, projects, workspaceFileChanges } from "../db/schema.js";
import { resolveInWorkspace } from "../tools/context.js";
import { isTextFile, mimeTypeForPath } from "../tools/file-types.js";
import { prepareWorkspace } from "../tools/git-ops.js";
import { execFileSync } from "node:child_process";

export type WorkspaceTreeNode =
  | { type: "file"; name: string; path: string }
  | { type: "dir"; name: string; path: string; children: WorkspaceTreeNode[] };

export function getSessionWorkspaceDir(sessionId: string): string {
  return join(env.WORKSPACE_ROOT, "sessions", sessionId);
}

export function getProjectWorkspaceDir(projectId: string): string {
  return join(env.WORKSPACE_ROOT, "projects", projectId);
}

export async function ensureProjectWorkspace(
  projectId: string,
  repoUrl: string,
  branch = "main"
): Promise<string> {
  if (!existsSync(env.WORKSPACE_ROOT)) {
    mkdirSync(env.WORKSPACE_ROOT, { recursive: true });
  }
  const dir = getProjectWorkspaceDir(projectId);
  prepareWorkspace(repoUrl, dir, branch);
  return dir;
}

export function deleteProjectWorkspace(projectId: string): void {
  const dir = getProjectWorkspaceDir(projectId);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function resolveWorkspaceRootForSession(sessionId: string): Promise<string> {
  const db = getAppDb();
  const [session] = await db
    .select({ projectId: chatSessions.projectId })
    .from(chatSessions)
    .where(eq(chatSessions.id, sessionId))
    .limit(1);
  if (!session) throw new Error("Session not found");

  if (session.projectId) {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, session.projectId))
      .limit(1);
    if (project) {
      return ensureProjectWorkspace(project.id, project.repoUrl, project.defaultBranch);
    }
  }

  const dir = getSessionWorkspaceDir(sessionId);
  if (existsSync(dir)) return dir;
  throw new Error("Workspace not found — open a project or start a run first");
}

export async function ensureSessionWorkspace(
  sessionId: string,
  repoUrl: string,
  branch = "main"
): Promise<string> {
  if (!existsSync(env.WORKSPACE_ROOT)) {
    mkdirSync(env.WORKSPACE_ROOT, { recursive: true });
  }
  const dir = getSessionWorkspaceDir(sessionId);
  prepareWorkspace(repoUrl, dir, branch);
  return dir;
}

export function deleteSessionWorkspace(sessionId: string): void {
  const dir = getSessionWorkspaceDir(sessionId);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Copy files from legacy session workspace into project workspace (one-way, non-destructive). */
export function migrateSessionWorkspaceToProject(sessionId: string, projectId: string): void {
  const sessionDir = getSessionWorkspaceDir(sessionId);
  const projectDir = getProjectWorkspaceDir(projectId);
  if (!existsSync(sessionDir)) return;
  if (!existsSync(projectDir)) mkdirSync(projectDir, { recursive: true });

  function copyDir(src: string, dest: string): void {
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const srcPath = join(src, entry.name);
      const destPath = join(dest, entry.name);
      if (entry.isDirectory()) {
        if (!existsSync(destPath)) mkdirSync(destPath, { recursive: true });
        copyDir(srcPath, destPath);
      } else if (!existsSync(destPath)) {
        cpSync(srcPath, destPath);
      }
    }
  }

  copyDir(sessionDir, projectDir);
}

const SKIP_DIRS = new Set([".git", "node_modules", ".next", "__pycache__"]);
const MAX_TREE_DEPTH = 8;
const MAX_TREE_ENTRIES = 500;

export function listWorkspaceTreeAtRoot(root: string): WorkspaceTreeNode[] {
  if (!existsSync(root)) return [];

  let count = 0;

  function walk(dir: string, rel: string, depth: number): WorkspaceTreeNode[] {
    if (depth > MAX_TREE_DEPTH || count >= MAX_TREE_ENTRIES) return [];
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith(".") || e.name === ".env.example")
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

    const nodes: WorkspaceTreeNode[] = [];
    for (const entry of entries) {
      if (count >= MAX_TREE_ENTRIES) break;
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;

      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
      count++;

      if (entry.isDirectory()) {
        nodes.push({
          type: "dir",
          name: entry.name,
          path: entryRel,
          children: walk(join(dir, entry.name), entryRel, depth + 1),
        });
      } else {
        nodes.push({ type: "file", name: entry.name, path: entryRel });
      }
    }
    return nodes;
  }

  return walk(root, "", 0);
}

export async function listWorkspaceTree(sessionId: string): Promise<WorkspaceTreeNode[]> {
  const root = await resolveWorkspaceRootForSession(sessionId);
  return listWorkspaceTreeAtRoot(root);
}

export type WorkspaceFileReadResult =
  | { kind: "text"; content: string }
  | { kind: "binary"; base64: string; mime: string; size: number };

export function flattenWorkspaceTree(nodes: WorkspaceTreeNode[]): string[] {
  const paths: string[] = [];
  function walk(list: WorkspaceTreeNode[]) {
    for (const node of list) {
      if (node.type === "file") paths.push(node.path);
      else walk(node.children);
    }
  }
  walk(nodes);
  return paths;
}

export function readWorkspaceFileExAtRoot(
  root: string,
  filePath: string
): WorkspaceFileReadResult {
  if (!existsSync(root)) throw new Error("Workspace not found");
  const target = resolveInWorkspace(root, filePath);
  if (!existsSync(target) || !statSync(target).isFile()) {
    throw new Error(`File not found: ${filePath}`);
  }
  if (isTextFile(filePath)) {
    return { kind: "text", content: readFileSync(target, "utf-8") };
  }
  const buf = readFileSync(target);
  return {
    kind: "binary",
    base64: buf.toString("base64"),
    mime: mimeTypeForPath(filePath),
    size: buf.length,
  };
}

export async function readWorkspaceFileEx(
  sessionId: string,
  filePath: string
): Promise<WorkspaceFileReadResult> {
  const root = await resolveWorkspaceRootForSession(sessionId);
  return readWorkspaceFileExAtRoot(root, filePath);
}

export async function readWorkspaceFileBinary(
  sessionId: string,
  filePath: string
): Promise<{ buffer: Buffer; mime: string; filename: string }> {
  const root = await resolveWorkspaceRootForSession(sessionId);
  if (!existsSync(root)) throw new Error("Workspace not found");
  const target = resolveInWorkspace(root, filePath);
  if (!existsSync(target) || !statSync(target).isFile()) {
    throw new Error(`File not found: ${filePath}`);
  }
  return {
    buffer: readFileSync(target),
    mime: mimeTypeForPath(filePath),
    filename: filePath.split("/").pop() ?? "download",
  };
}

export async function workspaceFileExists(sessionId: string, filePath: string): Promise<boolean> {
  const root = await resolveWorkspaceRootForSession(sessionId);
  if (!existsSync(root)) return false;
  try {
    const target = resolveInWorkspace(root, filePath);
    return existsSync(target) && statSync(target).isFile();
  } catch {
    return false;
  }
}

export async function readWorkspaceFile(sessionId: string, filePath: string): Promise<string> {
  const result = await readWorkspaceFileEx(sessionId, filePath);
  if (result.kind === "binary") {
    throw new Error(`Binary file cannot be read as text: ${filePath}`);
  }
  return result.content;
}

export async function writeWorkspaceFile(
  sessionId: string,
  filePath: string,
  content: string
): Promise<void> {
  const root = await resolveWorkspaceRootForSession(sessionId);
  if (!existsSync(root)) throw new Error("Workspace not found");
  const target = resolveInWorkspace(root, filePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf-8");
}

export async function recordUserFileChange(params: {
  chatSessionId: string;
  path: string;
  action: "write" | "edit";
  beforeText: string;
  afterText: string;
}): Promise<void> {
  await recordFileChange({
    chatSessionId: params.chatSessionId,
    runId: null,
    agentId: "user",
    path: params.path,
    action: params.action,
    beforeText: params.beforeText,
    afterText: params.afterText,
  });
}

export async function buildWorkspaceZip(sessionId: string): Promise<Buffer> {
  const root = await resolveWorkspaceRootForSession(sessionId);
  if (!existsSync(root)) throw new Error("Workspace not found");

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const passthrough = new PassThrough();
    passthrough.on("data", (chunk: Buffer) => chunks.push(chunk));
    passthrough.on("end", () => resolve(Buffer.concat(chunks)));
    passthrough.on("error", reject);

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on("error", reject);
    archive.pipe(passthrough);
    archive.glob("**/*", {
      cwd: root,
      ignore: [".git/**", "node_modules/**", ".next/**", "__pycache__/**"],
    });
    void archive.finalize();
  });
}

const OUTPUT_PREFIXES = ["docs/", "output/", "src/"];

export async function listWorkspaceOutputs(sessionId: string) {
  const tree = await listWorkspaceTree(sessionId);
  const allPaths = flattenWorkspaceTree(tree);
  const deliverableFiles = allPaths.filter((p) =>
    OUTPUT_PREFIXES.some((prefix) => p.startsWith(prefix))
  );

  const changes = await listFileChanges(sessionId, 80);
  const recentByPath = new Map<
    string,
    { id: string; path: string; agent_id: string; action: string; created_at: string | null }
  >();
  for (const change of changes) {
    if (!recentByPath.has(change.path)) {
      recentByPath.set(change.path, {
        id: change.id,
        path: change.path,
        agent_id: change.agentId,
        action: change.action,
        created_at: change.createdAt?.toISOString() ?? null,
      });
    }
  }

  return {
    deliverable_files: deliverableFiles,
    recent: [...recentByPath.values()],
  };
}

export async function getGitDiffForFile(sessionId: string, filePath: string): Promise<string | null> {
  const root = await resolveWorkspaceRootForSession(sessionId);
  if (!existsSync(root)) return null;
  try {
    const out = execFileSync("git", ["diff", "HEAD", "--", filePath], {
      cwd: root,
      encoding: "utf-8",
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

export async function recordFileChange(params: {
  chatSessionId: string;
  runId?: string | null;
  agentId: string;
  path: string;
  action: "write" | "edit";
  beforeText: string;
  afterText: string;
}): Promise<void> {
  const db = getAppDb();
  await db.insert(workspaceFileChanges).values({
    chatSessionId: params.chatSessionId,
    runId: params.runId ?? null,
    agentId: params.agentId,
    path: params.path,
    action: params.action,
    beforeText: params.beforeText,
    afterText: params.afterText,
  });
}

export async function listFileChanges(sessionId: string, limit = 200) {
  const db = getAppDb();
  return db
    .select({
      id: workspaceFileChanges.id,
      runId: workspaceFileChanges.runId,
      agentId: workspaceFileChanges.agentId,
      path: workspaceFileChanges.path,
      action: workspaceFileChanges.action,
      createdAt: workspaceFileChanges.createdAt,
    })
    .from(workspaceFileChanges)
    .where(eq(workspaceFileChanges.chatSessionId, sessionId))
    .orderBy(desc(workspaceFileChanges.createdAt))
    .limit(limit);
}

export async function getFileChange(sessionId: string, changeId: string) {
  const db = getAppDb();
  const [row] = await db
    .select()
    .from(workspaceFileChanges)
    .where(eq(workspaceFileChanges.id, changeId))
    .limit(1);
  if (!row || row.chatSessionId !== sessionId) return null;
  return row;
}

export async function deleteSessionFileChanges(sessionId: string): Promise<void> {
  const db = getAppDb();
  await db
    .delete(workspaceFileChanges)
    .where(eq(workspaceFileChanges.chatSessionId, sessionId));
}

/** Relative path helper for display */
export async function workspaceRelativePath(
  sessionId: string,
  absolutePath: string
): Promise<string> {
  const root = await resolveWorkspaceRootForSession(sessionId);
  return relative(root, absolutePath).replace(/\\/g, "/");
}
