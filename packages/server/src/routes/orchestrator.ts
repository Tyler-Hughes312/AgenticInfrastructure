import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AVAILABLE_TOOL_NAMES,
  getDefaultOrchestratorConfig,
  normalizeOrchestratorConfig,
  type OrchestratorGraphConfig,
} from "../agents/agent-registry.js";
import {
  getGraphSchemaFromConfig,
  getSessionOrchestratorConfig,
  setSessionOrchestratorConfig,
} from "../agents/dynamic-graph.js";
import { getRoutingPolicyForApi } from "../agents/routing-policy.js";
import { getSkillCatalogForApi } from "../agents/skill-catalog.js";

const agentSchema = z.object({
  id: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1),
  role: z.string().min(1),
  prompt: z.string().optional(),
  tools: z.array(z.string()).min(1),
  skills: z.array(z.string()).optional(),
  model: z.string().optional(),
  routesTo: z.array(z.string()).default([]),
  launchWhen: z.array(z.string()).optional(),
  doNotLaunchWhen: z.array(z.string()).optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
});

const graphSchema = z.object({
  agents: z.array(agentSchema).default([]),
  edges: z.array(
    z.object({
      source: z.string(),
      target: z.string(),
      label: z.string().optional(),
    })
  ),
  supervisorModel: z.string().optional(),
});

export async function orchestratorRoutes(app: FastifyInstance) {
  app.get("/api/orchestrator/graph", async () => {
    const config = getSessionOrchestratorConfig();
    return {
      config,
      schema: getGraphSchemaFromConfig(config),
      available_tools: AVAILABLE_TOOL_NAMES,
      available_skills: getSkillCatalogForApi(),
      routing: getRoutingPolicyForApi(),
    };
  });

  app.put("/api/orchestrator/graph", async (req, reply) => {
    const body = graphSchema.parse(req.body);
    const config = normalizeOrchestratorConfig(body as OrchestratorGraphConfig);
    setSessionOrchestratorConfig(config);
    return reply.send({
      ok: true,
      config,
      schema: getGraphSchemaFromConfig(config),
    });
  });

  app.post("/api/orchestrator/reset", async (_req, reply) => {
    const config = getDefaultOrchestratorConfig();
    setSessionOrchestratorConfig(config);
    return reply.send({ ok: true, config, schema: getGraphSchemaFromConfig(config) });
  });
}
