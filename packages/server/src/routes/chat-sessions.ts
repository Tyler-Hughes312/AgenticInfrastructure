import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AVAILABLE_TOOL_NAMES,
  normalizeOrchestratorConfig,
  type OrchestratorGraphConfig,
} from "../agents/agent-registry.js";
import { getGraphSchemaFromConfig } from "../agents/dynamic-graph.js";
import { getRoutingPolicyForApi } from "../agents/routing-policy.js";
import { getSkillCatalogForApi } from "../agents/skill-catalog.js";
import {
  appendChatMessage,
  createChatSession,
  deleteChatSession,
  duplicateChatSession,
  getChatSession,
  listChatMessages,
  listChatSessionsDetailed,
  saveChatSessionGraph,
  updateChatSessionTitle,
} from "../services/chat-session-service.js";

const graphSchema = z.object({
  agents: z.array(z.record(z.unknown())).default([]),
  edges: z.array(
    z.object({
      source: z.string(),
      target: z.string(),
      label: z.string().optional(),
    })
  ),
  supervisorModel: z.string().optional(),
  deliverableMode: z.record(z.unknown()).optional(),
});

function mapSessionSummary(s: Awaited<ReturnType<typeof listChatSessionsDetailed>>[number]) {
  return {
    id: s.id,
    project_id: s.projectId,
    title: s.title,
    agent_count: s.agentCount,
    message_count: s.messageCount,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}

export async function chatSessionRoutes(app: FastifyInstance) {
  app.get("/api/chat-sessions", async () => {
    const rows = await listChatSessionsDetailed();
    return rows.map(mapSessionSummary);
  });

  app.post("/api/chat-sessions", async (req, reply) => {
    const body = z
      .object({
        project_id: z.string().uuid().optional(),
        title: z.string().optional(),
      })
      .parse(req.body ?? {});
    const session = await createChatSession(body.project_id, body.title);
    const config = normalizeOrchestratorConfig(
      JSON.parse(session.graphConfig) as OrchestratorGraphConfig
    );
    return reply.code(201).send({
      id: session.id,
      project_id: session.projectId,
      title: session.title,
      config,
      schema: getGraphSchemaFromConfig(config),
      messages: [],
      available_tools: AVAILABLE_TOOL_NAMES,
      available_skills: getSkillCatalogForApi(),
      routing: getRoutingPolicyForApi(),
    });
  });

  app.get("/api/chat-sessions/:sessionId", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const session = await getChatSession(sessionId);
    if (!session) return reply.code(404).send({ error: "Chat session not found" });
    const messages = await listChatMessages(sessionId);
    return {
      id: session.id,
      project_id: session.projectId,
      title: session.title,
      config: session.graphConfig,
      schema: getGraphSchemaFromConfig(session.graphConfig),
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        run_id: m.runId,
        ts: m.createdAt?.getTime() ?? Date.now(),
      })),
      available_tools: AVAILABLE_TOOL_NAMES,
      available_skills: getSkillCatalogForApi(),
      routing: getRoutingPolicyForApi(),
    };
  });

  app.patch("/api/chat-sessions/:sessionId", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const session = await getChatSession(sessionId);
    if (!session) return reply.code(404).send({ error: "Chat session not found" });
    const body = z.object({ title: z.string().min(1).max(200) }).parse(req.body);
    await updateChatSessionTitle(sessionId, body.title.trim());
    return reply.send({ ok: true, title: body.title.trim() });
  });

  app.post("/api/chat-sessions/:sessionId/duplicate", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const body = z.object({ title: z.string().optional() }).parse(req.body ?? {});
    try {
      const copy = await duplicateChatSession(sessionId, body.title);
      const config = normalizeOrchestratorConfig(
        JSON.parse(copy.graphConfig) as OrchestratorGraphConfig
      );
      return reply.code(201).send({
        id: copy.id,
        title: copy.title,
        config,
        schema: getGraphSchemaFromConfig(config),
      });
    } catch {
      return reply.code(404).send({ error: "Chat session not found" });
    }
  });

  app.delete("/api/chat-sessions/:sessionId", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const session = await getChatSession(sessionId);
    if (!session) return reply.code(404).send({ error: "Chat session not found" });
    await deleteChatSession(sessionId);
    return reply.send({ ok: true });
  });

  app.put("/api/chat-sessions/:sessionId/graph", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const session = await getChatSession(sessionId);
    if (!session) return reply.code(404).send({ error: "Chat session not found" });
    const body = graphSchema.parse(req.body);
    const config = await saveChatSessionGraph(
      sessionId,
      normalizeOrchestratorConfig(body as OrchestratorGraphConfig)
    );
    return reply.send({
      ok: true,
      config,
      schema: getGraphSchemaFromConfig(config),
    });
  });

  app.post("/api/chat-sessions/:sessionId/messages", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const session = await getChatSession(sessionId);
    if (!session) return reply.code(404).send({ error: "Chat session not found" });
    const body = z
      .object({
        role: z.enum(["user", "assistant", "status"]),
        content: z.string(),
        run_id: z.string().uuid().optional(),
      })
      .parse(req.body);
    const row = await appendChatMessage(sessionId, body.role, body.content, body.run_id);
    return reply.code(201).send({
      id: row.id,
      role: row.role,
      content: row.content,
      run_id: row.runId,
      ts: row.createdAt?.getTime() ?? Date.now(),
    });
  });
}
