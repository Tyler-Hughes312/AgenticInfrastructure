import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { warmCopilotTokenFromEnv } from "./auth/copilot-token.js";
import { env, corsOrigins, logEnvSummary } from "./config.js";
import { setupDb, shutdownDb } from "./db.js";
import { setupAppTables } from "./db/app-db.js";
import { projectRoutes } from "./routes/projects.js";
import { runRoutes } from "./routes/runs.js";
import { agentLensCompatRoutes } from "./routes/agentlens-compat.js";
import { settingsRoutes } from "./routes/settings.js";
import { orchestratorRoutes } from "./routes/orchestrator.js";
import { chatSessionRoutes } from "./routes/chat-sessions.js";
import { graphTemplateRoutes } from "./routes/graph-templates.js";
import { workspaceRoutes } from "./routes/workspace.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: corsOrigins.length ? corsOrigins : true });
await app.register(websocket);

app.get("/health", async () => ({ status: "ok" }));

await projectRoutes(app);
await runRoutes(app);
await settingsRoutes(app);
await orchestratorRoutes(app);
await chatSessionRoutes(app);
await graphTemplateRoutes(app);
await workspaceRoutes(app);
await agentLensCompatRoutes(app);

async function start() {
  logEnvSummary();
  await warmCopilotTokenFromEnv();
  try {
    await setupDb();
    await setupAppTables();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('role "postgres" does not exist')) {
      console.error(
        "\nDatabase connection failed: no PostgreSQL role 'postgres'.\n" +
          "Use your local Postgres user in packages/server/.env:\n" +
          "  DATABASE_URL=postgresql://<your-mac-username>@localhost:5432/agent_platform\n" +
          "Then run: createdb agent_platform\n"
      );
    }
    throw err;
  }
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
}

async function shutdown() {
  await app.close();
  await shutdownDb();
}

process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
