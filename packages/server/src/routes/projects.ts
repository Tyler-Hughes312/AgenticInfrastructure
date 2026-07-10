import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  openProject,
} from "../services/project-service.js";

const createProjectSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  repo_url: z.string().min(1),
  default_branch: z.string().min(1).max(120).optional(),
});

export async function projectRoutes(app: FastifyInstance) {
  app.get("/api/projects", async () => {
    const rows = await listProjects();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      repo_url: r.repoUrl,
      source_type: r.sourceType,
      default_branch: r.defaultBranch,
      created_at: r.createdAt.toISOString(),
    }));
  });

  app.get("/api/projects/:projectId", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const project = await getProject(projectId);
    if (!project) return reply.code(404).send({ error: "Project not found" });
    return {
      id: project.id,
      name: project.name,
      repo_url: project.repoUrl,
      source_type: project.sourceType,
      default_branch: project.defaultBranch,
      created_at: project.createdAt.toISOString(),
    };
  });

  app.post("/api/projects", async (req, reply) => {
    const body = createProjectSchema.parse(req.body);
    try {
      const row = await createProject(body);
      return reply.code(201).send({
        id: row.id,
        name: row.name,
        repo_url: row.repoUrl,
        source_type: row.sourceType,
        default_branch: row.defaultBranch,
        created_at: row.createdAt.toISOString(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: message });
    }
  });

  app.post("/api/projects/:projectId/open", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const body = z.object({ title: z.string().max(200).optional() }).parse(req.body ?? {});
    try {
      const opened = await openProject(projectId, body.title);
      return reply.code(201).send({
        project_id: opened.project.id,
        session_id: opened.session.id,
        title: opened.session.title,
        repo_url: opened.project.repoUrl,
        source_type: opened.project.sourceType,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(404).send({ error: message });
    }
  });

  app.delete("/api/projects/:projectId", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    try {
      await deleteProject(projectId);
      return reply.send({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: message });
    }
  });

  // Legacy routes (deprecated)
  app.get("/projects", async () => {
    const rows = await listProjects();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      repo_url: r.repoUrl,
      created_at: r.createdAt,
    }));
  });
}
