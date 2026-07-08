import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { getPool } from "../db.js";
import * as schema from "./schema.js";

let appDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getAppDb() {
  if (!appDb) {
    appDb = drizzle(getPool(), { schema });
  }
  return appDb;
}

export async function setupAppTables(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      repo_url TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id),
      status TEXT NOT NULL DEFAULT 'pending',
      task TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT 'agent/run',
      langfuse_trace_url TEXT,
      github_pr_url TEXT,
      error TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES runs(id),
      type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export { schema, sql };
