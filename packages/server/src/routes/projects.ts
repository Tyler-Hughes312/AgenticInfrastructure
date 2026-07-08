import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getAppDb } from "../db/app-db.js";
import { projects } from "../db/schema.js";
import { env } from "../config.js";

const createProjectSchema = z.object({
  name: z.string().min(1),
  repo_url: z.string().url(),
});

export async function projectRoutes(app: FastifyInstance) {
  app.post("/projects", async (req, reply) => {
    const body = createProjectSchema.parse(req.body);
    const db = getAppDb();
    const [row] = await db
      .insert(projects)
      .values({ name: body.name, repoUrl: body.repo_url })
      .returning();
    return reply.code(201).send({
      id: row.id,
      name: row.name,
      repo_url: row.repoUrl,
      created_at: row.createdAt,
    });
  });

  app.get("/projects", async () => {
    const db = getAppDb();
    const rows = await db.select().from(projects);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      repo_url: r.repoUrl,
      created_at: r.createdAt,
    }));
  });
}
