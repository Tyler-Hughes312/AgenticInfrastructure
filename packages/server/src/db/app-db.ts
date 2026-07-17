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
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'local'
  `).catch(() => {});
  await pool.query(`
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS default_branch TEXT NOT NULL DEFAULT 'main'
  `).catch(() => {});
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID REFERENCES projects(id),
      title TEXT,
      graph_config TEXT NOT NULL DEFAULT '{"agents":[],"edges":[]}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS chat_session_id UUID REFERENCES chat_sessions(id)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id UUID NOT NULL REFERENCES chat_sessions(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      run_id UUID REFERENCES runs(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspace_file_changes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      chat_session_id UUID NOT NULL REFERENCES chat_sessions(id),
      run_id UUID REFERENCES runs(id),
      agent_id TEXT NOT NULL,
      path TEXT NOT NULL,
      action TEXT NOT NULL,
      before_text TEXT NOT NULL DEFAULT '',
      after_text TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    ALTER TABLE workspace_file_changes ALTER COLUMN run_id DROP NOT NULL
  `).catch(() => {});
  await pool.query(`
    ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS graph_template_id UUID
  `).catch(() => {});
  await pool.query(`
    CREATE TABLE IF NOT EXISTS saved_graph_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      graph_config TEXT NOT NULL,
      source_session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
      agent_count TEXT NOT NULL DEFAULT '0',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Existing DBs may have a RESTRICT FK — migrate to SET NULL.
  await pool.query(`
    DO $$
    DECLARE
      conname text;
    BEGIN
      SELECT tc.constraint_name INTO conname
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'saved_graph_templates'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'source_session_id'
      LIMIT 1;
      IF conname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE saved_graph_templates DROP CONSTRAINT %I', conname);
        ALTER TABLE saved_graph_templates
          ADD CONSTRAINT saved_graph_templates_source_session_id_fkey
          FOREIGN KEY (source_session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `).catch(() => {});
}

export { schema, sql };
