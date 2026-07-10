import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { normalizeOrchestratorConfig, type OrchestratorGraphConfig } from "../agents/agent-registry.js";
import { getGraphSchemaFromConfig } from "../agents/dynamic-graph.js";
import { getChatSession } from "../services/chat-session-service.js";
import {
  applyTemplateToSession,
  deleteSavedGraphTemplate,
  getSavedGraphTemplate,
  listSavedGraphTemplates,
  openTemplateAsNewSession,
  saveGraphTemplate,
} from "../services/graph-template-service.js";

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

export async function graphTemplateRoutes(app: FastifyInstance) {
  app.get("/api/graph-templates", async () => {
    const rows = await listSavedGraphTemplates();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      agent_count: r.agentCount,
      source_session_id: r.sourceSessionId,
      created_at: r.createdAt.toISOString(),
      updated_at: r.updatedAt.toISOString(),
    }));
  });

  app.get("/api/graph-templates/:templateId", async (req, reply) => {
    const { templateId } = req.params as { templateId: string };
    const template = await getSavedGraphTemplate(templateId);
    if (!template) return reply.code(404).send({ error: "Saved infrastructure not found" });
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      config: template.config,
      schema: getGraphSchemaFromConfig(template.config),
      agent_count: template.agentCount,
      created_at: template.createdAt.toISOString(),
      updated_at: template.updatedAt.toISOString(),
    };
  });

  /** Explicit save — client must call this endpoint (not auto on edit). */
  app.post("/api/graph-templates", async (req, reply) => {
    const body = z
      .object({
        name: z.string().min(1).max(120),
        description: z.string().max(500).optional(),
        config: graphSchema.optional(),
        session_id: z.string().uuid().optional(),
      })
      .parse(req.body);

    let config: OrchestratorGraphConfig;
    let sourceSessionId: string | undefined;

    if (body.session_id) {
      const session = await getChatSession(body.session_id);
      if (!session) return reply.code(404).send({ error: "Chat session not found" });
      config = session.graphConfig;
      sourceSessionId = body.session_id;
    } else if (body.config) {
      config = normalizeOrchestratorConfig(body.config as OrchestratorGraphConfig);
    } else {
      return reply.code(400).send({ error: "Provide config or session_id" });
    }

    try {
      const saved = await saveGraphTemplate({
        name: body.name,
        description: body.description,
        config,
        sourceSessionId,
      });
      return reply.code(201).send({
        id: saved.id,
        name: saved.name,
        description: saved.description,
        config: saved.config,
        schema: getGraphSchemaFromConfig(saved.config),
        agent_count: saved.agentCount,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: message });
    }
  });

  app.delete("/api/graph-templates/:templateId", async (req, reply) => {
    const { templateId } = req.params as { templateId: string };
    const existing = await getSavedGraphTemplate(templateId);
    if (!existing) return reply.code(404).send({ error: "Saved infrastructure not found" });
    await deleteSavedGraphTemplate(templateId);
    return reply.send({ ok: true });
  });

  /** Start a new session on a project with a saved graph blueprint. */
  app.post("/api/graph-templates/:templateId/open", async (req, reply) => {
    const { templateId } = req.params as { templateId: string };
    const body = z
      .object({
        project_id: z.string().uuid(),
        title: z.string().max(200).optional(),
      })
      .parse(req.body ?? {});
    try {
      const opened = await openTemplateAsNewSession(templateId, body.project_id, body.title);
      return reply.code(201).send({
        session_id: opened.sessionId,
        project_id: opened.projectId,
        title: opened.title,
        config: opened.config,
        schema: getGraphSchemaFromConfig(opened.config),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(404).send({ error: message });
    }
  });

  /** Apply template to an existing session (replaces graph). */
  app.post("/api/graph-templates/:templateId/apply", async (req, reply) => {
    const { templateId } = req.params as { templateId: string };
    const body = z.object({ session_id: z.string().uuid() }).parse(req.body);
    try {
      const applied = await applyTemplateToSession(templateId, body.session_id);
      return reply.send({
        session_id: applied.sessionId,
        template_name: applied.templateName,
        config: applied.config,
        schema: getGraphSchemaFromConfig(applied.config),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(404).send({ error: message });
    }
  });
}
