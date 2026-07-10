import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { eq } from "drizzle-orm";
import { env } from "../config.js";
import { getAppDb } from "../db/app-db.js";
import { chatSessions, projects, runs } from "../db/schema.js";
import { parseCredentialsFromBody } from "../credentials/parse.js";
import { resolveCredentials } from "../credentials/store.js";
import type { RunCredentials } from "../credentials/types.js";
import {
  getGraphSchemaAgentLens,
  releaseSessionWorkspace,
  startRunFromQuestion,
  streamFollowUpToRun,
  streamRunAgentLensEvents,
  deleteRun,
} from "../services/run-service.js";
import { normalizeOrchestratorConfig, type OrchestratorGraphConfig } from "../agents/agent-registry.js";
import { setSessionOrchestratorConfig } from "../agents/dynamic-graph.js";
import { isLegacyLoopingConfig } from "../agents/software-dev-pipeline.js";
import { isRemoteRepo, LOCAL_WORKSPACE_REPO } from "../tools/git-ops.js";
import { taskNeedsGithubToken } from "../agents/pipeline-gate.js";
import { createChatSession, getChatSession, getChatSessionGraph, saveChatSessionGraph } from "../services/chat-session-service.js";
import { getProject } from "../services/project-service.js";

const runAgentSchema = z.object({
  question: z.string().min(1),
  project_id: z.string().uuid().optional(),
  credentials: z.record(z.string()).optional(),
});

type WsPayload = {
  type?: "start" | "follow_up";
  question?: string;
  project_id?: string;
  chat_session_id?: string;
  credentials?: Record<string, string>;
  target_agent?: string;
  orchestrator_config?: OrchestratorGraphConfig;
};

async function resolveProjectForRun(
  payload: WsPayload,
  sessionChatId: string | null,
  credentials: RunCredentials
) {
  if (sessionChatId) {
    const session = await getChatSession(sessionChatId);
    if (session?.projectId) {
      const project = await getProject(session.projectId);
      if (project) return project;
    }
  }
  if (payload.project_id) {
    const project = await getProject(payload.project_id);
    if (!project) throw new Error("Project not found");
    return project;
  }
  return resolveProject(undefined, credentials);
}

async function resolveProject(projectId?: string, credentials?: RunCredentials) {
  const db = getAppDb();
  const creds = resolveCredentials(credentials);
  const repoUrl = (creds.defaultRepoUrl?.trim() || LOCAL_WORKSPACE_REPO);

  if (projectId) {
    const [p] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!p) throw new Error("Project not found");
    return p;
  }

  const existing = await db
    .select()
    .from(projects)
    .where(eq(projects.repoUrl, repoUrl))
    .limit(1);
  if (existing[0]) return existing[0];

  const name =
    repoUrl === LOCAL_WORKSPACE_REPO
      ? `${env.DEFAULT_PROJECT_NAME}-local`
      : env.DEFAULT_PROJECT_NAME;
  const [created] = await db.insert(projects).values({ name, repoUrl }).returning();
  return created;
}

function resolveGithubToken(credentials?: RunCredentials, repoUrl?: string, task?: string): string {
  const creds = resolveCredentials(credentials);
  const token = creds.githubToken ?? "";
  const needsToken = isRemoteRepo(repoUrl ?? creds.defaultRepoUrl) || taskNeedsGithubToken(task ?? "");
  if (needsToken && !token) {
    throw new Error(
      "GitHub token required for repo creation, push, or PR. Set GITHUB_TOKEN in server .env or Settings."
    );
  }
  return token;
}

function sendError(socket: WebSocket, message: string) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify({ event: "error", data: { message } }));
  }
}

async function streamEventsToSocket(
  socket: WebSocket,
  generator: AsyncGenerator<Record<string, unknown>>,
  runId?: string
) {
  for await (const event of generator) {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(event));
    } else {
      break;
    }
  }
  if (socket.readyState === socket.OPEN && runId) {
    socket.send(JSON.stringify({ event: "turn_complete", run_id: runId }));
  }
}

export async function agentLensCompatRoutes(app: FastifyInstance) {
  app.get("/api/graph-schema", async () => getGraphSchemaAgentLens());

  app.get("/api/runs", async () => {
    const db = getAppDb();
    const rows = await db.select().from(runs);
    return rows.map((r) => ({
      id: r.id,
      project_id: r.projectId,
      chat_session_id: r.chatSessionId,
      status: r.status,
      task: r.task,
      started_at: r.startedAt,
      completed_at: r.completedAt,
      langfuse_trace_url: r.langfuseTraceUrl,
      github_pr_url: r.githubPrUrl,
      error: r.error,
    }));
  });

  app.delete("/api/runs/:runId", async (req, reply) => {
    const runId = (req.params as { runId: string }).runId;
    const db = getAppDb();
    const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
    if (!run) return reply.code(404).send({ error: "Run not found" });
    await deleteRun(runId);
    return reply.send({ ok: true });
  });

  app.post("/api/run-agent", async (req, reply) => {
    const body = runAgentSchema.parse(req.body);
    const credentials = parseCredentialsFromBody(req.body);
    const project = await resolveProject(body.project_id, credentials);
    const runId = uuidv4();
    const branch = `agent/run-${runId.slice(0, 8)}`;
    const db = getAppDb();
    await db.insert(runs).values({
      id: runId,
      projectId: project.id,
      status: "pending",
      task: body.question,
      threadId: runId,
      branch,
    });
    void startRunFromQuestion({
      runId,
      projectId: project.id,
      task: body.question,
      repoUrl: project.repoUrl,
      githubToken: resolveGithubToken(credentials, project.repoUrl, body.question),
      branch,
      credentials,
    });
    return reply.code(201).send({ run_id: runId });
  });

  app.get("/api/trace/:runId", async (req, reply) => {
    const runId = (req.params as { runId: string }).runId;
    const db = getAppDb();
    const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
    if (!run) return reply.code(404).send({ error: "Run not found" });
    return {
      run_id: run.id,
      task: run.task,
      status: run.status,
      started_at: run.startedAt,
      completed_at: run.completedAt,
      langfuse_trace_url: run.langfuseTraceUrl,
      github_pr_url: run.githubPrUrl,
      error: run.error,
    };
  });

  app.post("/api/drift", async (req, reply) => {
    const body = req.body as Record<string, unknown> | undefined;
    const keys = body ? Object.keys(body).length : 0;
    return reply.send({
      drift_score: keys > 0 ? 0.05 : 0,
      overlap: keys > 0 ? 0.92 : 1,
      cite_score: 0.85,
      flags: keys > 0 ? [] : ["No agent state captured yet"],
    });
  });

  app.get("/api/analytics/:runId", async (_req, reply) => {
    return reply.send({ nodes: [], total_tokens: 0, total_cost: 0 });
  });

  app.get("/ws/run", { websocket: true }, (socket) => {
    let sessionRunId: string | null = null;
    let sessionChatId: string | null = null;
    let sessionCredentials: RunCredentials = {};
    let sessionOrchestratorConfig: OrchestratorGraphConfig | undefined;
    let processing = false;

    const cleanup = () => {
      if (sessionRunId) {
        releaseSessionWorkspace(sessionRunId);
        sessionRunId = null;
      }
    };

    socket.on("close", cleanup);

    socket.on("message", async (raw) => {
      if (processing) {
        sendError(socket, "A run is already in progress on this connection");
        return;
      }

      processing = true;
      try {
        const payload = JSON.parse(String(raw)) as WsPayload;
        const messageType = payload.type ?? (payload.question ? "start" : undefined);
        const question = payload.question?.trim();
        const targetAgent = payload.target_agent?.trim() || undefined;

        if (payload.chat_session_id) {
          sessionChatId = payload.chat_session_id;
        }

        if (payload.orchestrator_config) {
          const incoming = normalizeOrchestratorConfig(payload.orchestrator_config);
          if (incoming.agents.length > 0 && !isLegacyLoopingConfig(incoming)) {
            sessionOrchestratorConfig = incoming;
            setSessionOrchestratorConfig(incoming);
            if (sessionChatId) {
              await saveChatSessionGraph(sessionChatId, incoming);
            }
          } else {
            sessionOrchestratorConfig = undefined;
          }
        } else if (sessionChatId && messageType === "follow_up") {
          sessionOrchestratorConfig = await getChatSessionGraph(sessionChatId);
          setSessionOrchestratorConfig(sessionOrchestratorConfig);
        }

        if (messageType === "follow_up") {
          if (!sessionRunId) {
            sendError(socket, "No active session. Send a start message first.");
            return;
          }
          if (!question) {
            sendError(socket, "question required for follow_up");
            return;
          }

          const followUpCredentials = parseCredentialsFromBody(payload);
          if (followUpCredentials.openaiApiKey || followUpCredentials.githubCopilotToken) {
            sessionCredentials = { ...sessionCredentials, ...followUpCredentials };
          }

          await streamEventsToSocket(
            socket,
            streamFollowUpToRun(
              sessionRunId,
              question,
              targetAgent,
              sessionCredentials,
              sessionOrchestratorConfig
            ),
            sessionRunId
          );
          return;
        }

        if (!question) {
          sendError(socket, "question required");
          return;
        }

        const credentials = parseCredentialsFromBody(payload);
        sessionCredentials = credentials;
        const project = await resolveProjectForRun(payload, sessionChatId, credentials);
        const db = getAppDb();

        if (!sessionChatId) {
          const created = await createChatSession(project.id);
          sessionChatId = created.id;
          if (socket.readyState === socket.OPEN) {
            socket.send(
              JSON.stringify({
                event: "chat_session_bound",
                data: { chat_session_id: sessionChatId, project_id: project.id },
                ts: Date.now(),
              })
            );
          }
        } else {
          const session = await getChatSession(sessionChatId);
          if (session && !session.projectId) {
            await db
              .update(chatSessions)
              .set({ projectId: project.id })
              .where(eq(chatSessions.id, sessionChatId));
            if (socket.readyState === socket.OPEN) {
              socket.send(
                JSON.stringify({
                  event: "project_bound",
                  data: { project_id: project.id, chat_session_id: sessionChatId },
                  ts: Date.now(),
                })
              );
            }
          }
        }

        const runId = uuidv4();
        const branch = `agent/run-${runId.slice(0, 8)}`;
        await db.insert(runs).values({
          id: runId,
          projectId: project.id,
          chatSessionId: sessionChatId,
          status: "pending",
          task: question,
          threadId: runId,
          branch,
        });
        sessionRunId = runId;

        if (!sessionOrchestratorConfig && sessionChatId) {
          sessionOrchestratorConfig = await getChatSessionGraph(sessionChatId);
          setSessionOrchestratorConfig(sessionOrchestratorConfig);
        }

        await streamEventsToSocket(
          socket,
          streamRunAgentLensEvents({
            runId,
            projectId: project.id,
            task: question,
            repoUrl: project.repoUrl,
            githubToken: resolveGithubToken(credentials, project.repoUrl, question),
            branch,
            credentials,
            keepWorkspace: true,
            orchestratorConfig: sessionOrchestratorConfig,
            targetAgent,
            chatSessionId: sessionChatId,
          }),
          runId
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sendError(socket, message);
      } finally {
        processing = false;
      }
    });
  });
}
