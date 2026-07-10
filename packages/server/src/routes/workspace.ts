import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getChatSession } from "../services/chat-session-service.js";
import {
  buildWorkspaceZip,
  getGitDiffForFile,
  listFileChanges,
  getFileChange,
  listWorkspaceOutputs,
  listWorkspaceTree,
  readWorkspaceFileEx,
  readWorkspaceFileBinary,
  recordUserFileChange,
  workspaceFileExists,
  writeWorkspaceFile,
} from "../services/workspace-service.js";

export async function workspaceRoutes(app: FastifyInstance) {
  app.get("/api/chat-sessions/:sessionId/workspace/tree", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const session = await getChatSession(sessionId);
    if (!session) return reply.code(404).send({ error: "Chat session not found" });
    return { tree: await listWorkspaceTree(sessionId) };
  });

  app.get("/api/chat-sessions/:sessionId/workspace/outputs", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const session = await getChatSession(sessionId);
    if (!session) return reply.code(404).send({ error: "Chat session not found" });
    return listWorkspaceOutputs(sessionId);
  });

  app.get("/api/chat-sessions/:sessionId/workspace/file", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const { path: filePath } = z.object({ path: z.string().min(1) }).parse(req.query);
    const session = await getChatSession(sessionId);
    if (!session) return reply.code(404).send({ error: "Chat session not found" });
    try {
      const file = await readWorkspaceFileEx(sessionId, filePath);
      const gitDiff = await getGitDiffForFile(sessionId, filePath);
      if (file.kind === "text") {
        return { path: filePath, encoding: "utf-8", content: file.content, git_diff: gitDiff };
      }
      return {
        path: filePath,
        encoding: "base64",
        content: file.base64,
        mime: file.mime,
        size: file.size,
        git_diff: gitDiff,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(404).send({ error: message });
    }
  });

  app.post("/api/chat-sessions/:sessionId/workspace/file", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const body = z.object({ path: z.string().min(1), content: z.string() }).parse(req.body);
    const session = await getChatSession(sessionId);
    if (!session) return reply.code(404).send({ error: "Chat session not found" });
    if (await workspaceFileExists(sessionId, body.path)) {
      return reply.code(409).send({ error: `File already exists: ${body.path}` });
    }
    try {
      await writeWorkspaceFile(sessionId, body.path, body.content);
      await recordUserFileChange({
        chatSessionId: sessionId,
        path: body.path,
        action: "write",
        beforeText: "",
        afterText: body.content,
      });
      return { ok: true, path: body.path };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: message });
    }
  });

  app.put("/api/chat-sessions/:sessionId/workspace/file", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const body = z.object({ path: z.string().min(1), content: z.string() }).parse(req.body);
    const session = await getChatSession(sessionId);
    if (!session) return reply.code(404).send({ error: "Chat session not found" });
    try {
      let beforeText = "";
      const existed = await workspaceFileExists(sessionId, body.path);
      if (existed) {
        try {
          const existing = await readWorkspaceFileEx(sessionId, body.path);
          if (existing.kind === "text") beforeText = existing.content;
          else beforeText = `[Binary file, ${existing.size} bytes]`;
        } catch {
          beforeText = "";
        }
      }
      await writeWorkspaceFile(sessionId, body.path, body.content);
      await recordUserFileChange({
        chatSessionId: sessionId,
        path: body.path,
        action: existed ? "edit" : "write",
        beforeText,
        afterText: body.content,
      });
      return { ok: true, path: body.path };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: message });
    }
  });

  app.get("/api/chat-sessions/:sessionId/workspace/file/download", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const { path: filePath } = z.object({ path: z.string().min(1) }).parse(req.query);
    const session = await getChatSession(sessionId);
    if (!session) return reply.code(404).send({ error: "Chat session not found" });
    try {
      const { buffer, mime, filename } = await readWorkspaceFileBinary(sessionId, filePath);
      return reply
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .header("Content-Type", mime)
        .send(buffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(404).send({ error: message });
    }
  });

  app.get("/api/chat-sessions/:sessionId/workspace/export/zip", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const session = await getChatSession(sessionId);
    if (!session) return reply.code(404).send({ error: "Chat session not found" });
    try {
      const zip = await buildWorkspaceZip(sessionId);
      const filename = `workspace-${sessionId.slice(0, 8)}.zip`;
      return reply
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .header("Content-Type", "application/zip")
        .send(zip);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(404).send({ error: message });
    }
  });

  app.get("/api/chat-sessions/:sessionId/workspace/changes", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const session = await getChatSession(sessionId);
    if (!session) return reply.code(404).send({ error: "Chat session not found" });
    const changes = await listFileChanges(sessionId);
    return {
      changes: changes.map((c) => ({
        id: c.id,
        run_id: c.runId,
        agent_id: c.agentId,
        path: c.path,
        action: c.action,
        created_at: c.createdAt?.toISOString() ?? null,
      })),
    };
  });

  app.get("/api/chat-sessions/:sessionId/workspace/changes/:changeId", async (req, reply) => {
    const { sessionId, changeId } = req.params as { sessionId: string; changeId: string };
    const session = await getChatSession(sessionId);
    if (!session) return reply.code(404).send({ error: "Chat session not found" });
    const change = await getFileChange(sessionId, changeId);
    if (!change) return reply.code(404).send({ error: "Change not found" });
    return {
      id: change.id,
      run_id: change.runId,
      agent_id: change.agentId,
      path: change.path,
      action: change.action,
      before: change.beforeText,
      after: change.afterText,
      created_at: change.createdAt?.toISOString() ?? null,
    };
  });
}
