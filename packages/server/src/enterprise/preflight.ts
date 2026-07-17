import pg from "pg";
import { env } from "../config.js";

/**
 * Fail fast with Windows-oriented guidance when local Postgres is unreachable.
 */
export async function preflightDatabase(): Promise<void> {
  const client = new pg.Client({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const lines = [
      "",
      "Local PostgreSQL preflight failed (Docker is not supported).",
      `  ${msg.split("\n")[0]}`,
      "",
      "Fix on Windows:",
      "  1. Start the PostgreSQL Windows service",
      "  2. Set DATABASE_URL in packages/server/.env",
      "     e.g. postgresql://postgres:YOUR_PASSWORD@localhost:5432/agent_platform",
      "  3. npm run setup:db",
      "  4. npm run doctor",
      "",
      "See docs/ENTERPRISE-WINDOWS.md",
      "",
    ];
    throw new Error(lines.join("\n"));
  } finally {
    await client.end().catch(() => {});
  }
}
