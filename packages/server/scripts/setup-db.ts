/**
 * Create local agent_platform database if missing (no Docker).
 * Usage: npm run setup:db
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(__dirname, "..");
const repoRoot = resolve(serverDir, "../..");

function loadEnv() {
  const serverEnv = resolve(serverDir, ".env");
  const rootEnv = resolve(repoRoot, ".env");
  if (existsSync(serverEnv)) dotenv.config({ path: serverEnv });
  if (existsSync(rootEnv)) dotenv.config({ path: rootEnv, override: true });
}

function maintenanceUrl(databaseUrl: string): { adminUrl: string; dbName: string } {
  const u = new URL(databaseUrl);
  const dbName = (u.pathname.replace(/^\//, "") || "agent_platform").split("?")[0];
  u.pathname = "/postgres";
  return { adminUrl: u.toString(), dbName };
}

async function main() {
  loadEnv();
  const databaseUrl =
    process.env.DATABASE_URL?.trim() || "postgresql://localhost:5432/agent_platform";

  try {
    const probe = new URL(databaseUrl);
    if (probe.port === "5433") {
      console.error("Refuse Docker-style DATABASE_URL (port 5433). Use local Postgres on 5432.");
      process.exit(1);
    }
  } catch {
    /* ignore */
  }

  const { adminUrl, dbName } = maintenanceUrl(databaseUrl);

  // Already exists?
  const appClient = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  try {
    await appClient.connect();
    console.log(`Database "${dbName}" already reachable.`);
    await appClient.end();
    process.exit(0);
  } catch {
    await appClient.end().catch(() => {});
  }

  console.log(`Creating database "${dbName}" via ${adminUrl.replace(/:[^:@/]+@/, ":****@")} …`);
  const admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 8000 });
  try {
    await admin.connect();
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (exists.rowCount) {
      console.log(`Database "${dbName}" already exists.`);
    } else {
      // identifiers cannot be parameterized
      const safe = dbName.replace(/[^a-zA-Z0-9_]/g, "");
      if (safe !== dbName) {
        throw new Error(`Unsafe database name: ${dbName}`);
      }
      await admin.query(`CREATE DATABASE ${safe}`);
      console.log(`Created database "${safe}".`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Failed to create database:", msg);
    console.error(
      "On Windows: ensure PostgreSQL service is running and DATABASE_URL uses the installer password.\n" +
        "Manual: psql -U postgres -c \"CREATE DATABASE agent_platform;\"\n" +
        "See docs/ENTERPRISE-WINDOWS.md"
    );
    process.exit(1);
  } finally {
    await admin.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
