import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { getAppDb } from "../db/app-db.js";
import { runs, projects } from "../db/schema.js";
import { env } from "../config.js";
import {
  startRun,
  subscribeRun,
  delegateToRun,
  getGraphSchemaAgentLens,
  deleteRun,
} from "../services/run-service.js";

const createRunSchema = z.object({
  task: z.string().min(1),
  branch: z.string().optional(),
});

const delegateSchema = z.object({
  task: z.string().min(1),
  target_worker: z.string().optional(),
});

export async function runRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>("/projects/:id/runs", async (req, reply) => {
    const body = createRunSchema.parse(req.body);
    const db = getAppDb();
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, req.params.id))
      .limit(1);
    if (!project) return reply.code(404).send({ error: "Project not found" });

    const runId = uuidv4();
    const branch = body.branch ?? `agent/run-${runId.slice(0, 8)}`;
    const [row] = await db
      .insert(runs)
      .values({
        id: runId,
        projectId: project.id,
        status: "pending",
        task: body.task,
        threadId: runId,
        branch,
      })
      .returning();

    void startRun({
      runId,
      projectId: project.id,
      task: body.task,
      repoUrl: project.repoUrl,
      githubToken: env.GITHUB_TOKEN,
      branch,
    });

    return reply.code(201).send({
      id: row.id,
      project_id: row.projectId,
      status: row.status,
      task: row.task,
      branch: row.branch,
      started_at: row.startedAt,
    });
  });

  app.get("/runs", async () => {
    const db = getAppDb();
    const rows = await db.select().from(runs);
    return rows.map((r) => ({
      id: r.id,
      project_id: r.projectId,
      chat_session_id: r.chatSessionId,
      status: r.status,
      task: r.task,
      branch: r.branch,
      started_at: r.startedAt,
      completed_at: r.completedAt,
      duration_ms:
        r.completedAt && r.startedAt
          ? r.completedAt.getTime() - r.startedAt.getTime()
          : null,
      langfuse_trace_url: r.langfuseTraceUrl,
      github_pr_url: r.githubPrUrl,
      error: r.error,
    }));
  });

  app.delete<{ Params: { id: string } }>("/runs/:id", async (req, reply) => {
    const db = getAppDb();
    const [run] = await db.select().from(runs).where(eq(runs.id, req.params.id)).limit(1);
    if (!run) return reply.code(404).send({ error: "Run not found" });
    await deleteRun(req.params.id);
    return reply.send({ ok: true });
  });

  app.get<{ Params: { id: string } }>("/runs/:id/graph", async (req, reply) => {
    const db = getAppDb();
    const [run] = await db.select().from(runs).where(eq(runs.id, req.params.id)).limit(1);
    if (!run) return reply.code(404).send({ error: "Run not found" });
    return getGraphSchemaAgentLens();
  });

  app.post<{ Params: { id: string } }>("/runs/:id/delegate", async (req, reply) => {
    const body = delegateSchema.parse(req.body);
    const db = getAppDb();
    const [run] = await db.select().from(runs).where(eq(runs.id, req.params.id)).limit(1);
    if (!run) return reply.code(404).send({ error: "Run not found" });
    await delegateToRun(req.params.id, body.task, body.target_worker);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>(
    "/runs/:id/stream",
    { websocket: true },
    (socket, req) => {
      const runId = (req.params as { id: string }).id;
      const unsubscribe = subscribeRun(runId, (event) => {
        socket.send(JSON.stringify(event));
      });
      socket.on("close", unsubscribe);
    }
  );
}
