/**
 * Enterprise preflight: Node, Postgres, ports, env keys, optional outbound probe.
 * Usage: npm run doctor
 */
import { createConnection } from "node:net";
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

type CheckResult = { name: string; ok: boolean; detail: string };

function checkNode(): CheckResult {
  const major = Number(process.versions.node.split(".")[0]);
  const ok = major >= 18;
  return {
    name: "Node.js",
    ok,
    detail: ok
      ? `v${process.versions.node} (${process.platform}/${process.arch})`
      : `v${process.versions.node} — need Node 18+`,
  };
}

function portStatus(port: number, host = "127.0.0.1"): Promise<CheckResult> {
  return new Promise((resolveCheck) => {
    const socket = createConnection({ port, host }, () => {
      socket.destroy();
      // Occupied is fine if the stack is already running — warn, don't fail.
      resolveCheck({
        name: `Port ${port}`,
        ok: true,
        detail: `in use on ${host}:${port} (stop other apps if npm run dev fails with EADDRINUSE)`,
      });
    });
    socket.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ECONNREFUSED") {
        resolveCheck({
          name: `Port ${port}`,
          ok: true,
          detail: `${host}:${port} is free`,
        });
      } else {
        resolveCheck({
          name: `Port ${port}`,
          ok: true,
          detail: `${host}:${port}: ${err.code ?? err.message}`,
        });
      }
    });
  });
}

async function checkPostgres(databaseUrl: string): Promise<CheckResult> {
  try {
    const u = new URL(databaseUrl);
    if (u.port === "5433" || (u.password === "postgres" && u.username === "postgres")) {
      return {
        name: "PostgreSQL",
        ok: false,
        detail: "DATABASE_URL looks like Docker — use local Postgres on port 5432",
      };
    }
  } catch {
    /* continue */
  }

  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const res = await client.query("SELECT current_database() AS db, current_user AS usr, version() AS v");
    const row = res.rows[0] as { db: string; usr: string; v: string };
    return {
      name: "PostgreSQL",
      ok: true,
      detail: `connected db=${row.db} user=${row.usr} (${String(row.v).split(",")[0]})`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    let hint = msg.split("\n")[0];
    if (msg.includes("ECONNREFUSED")) {
      hint =
        "Cannot reach Postgres on DATABASE_URL. On Windows: start the PostgreSQL service, then npm run setup:db";
    } else if (msg.includes("password authentication failed")) {
      hint = "Wrong password in DATABASE_URL — use the postgres user password from the Windows installer";
    } else if (msg.includes("does not exist")) {
      hint = `Database missing — run: npm run setup:db (${msg.split("\n")[0]})`;
    }
    return { name: "PostgreSQL", ok: false, detail: hint };
  } finally {
    await client.end().catch(() => {});
  }
}

function checkEnvKeys(): CheckResult[] {
  const openai = Boolean(process.env.OPENAI_API_KEY?.trim());
  const copilotSession = Boolean(process.env.GITHUB_COPILOT_TOKEN?.trim());
  const copilotOauth = Boolean(process.env.GITHUB_COPILOT_OAUTH_TOKEN?.trim());
  const github = Boolean(process.env.GITHUB_TOKEN?.trim());
  const llmOk = openai || copilotSession || copilotOauth || github;
  return [
    {
      name: "LLM credentials",
      ok: llmOk,
      detail: llmOk
        ? [
            copilotSession || copilotOauth ? "copilot" : null,
            openai ? "openai" : null,
            github && !copilotSession && !copilotOauth ? "github PAT (refresh)" : null,
          ]
            .filter(Boolean)
            .join("+") || "set"
        : "missing — run npm run copilot-login -w @agentic/server",
    },
    {
      name: "GITHUB_TOKEN",
      ok: true,
      detail: github ? "set" : "optional until you push/create repos",
    },
    {
      name: "Proxy / TLS",
      ok: true,
      detail: [
        process.env.HTTPS_PROXY || process.env.HTTP_PROXY
          ? `proxy=${process.env.HTTPS_PROXY || process.env.HTTP_PROXY}`
          : "no HTTPS_PROXY",
        process.env.NODE_EXTRA_CA_CERTS ? `CA=${process.env.NODE_EXTRA_CA_CERTS}` : null,
        process.env.NODE_USE_ENV_PROXY ? "NODE_USE_ENV_PROXY on" : null,
      ]
        .filter(Boolean)
        .join("; "),
    },
    {
      name: "ENTERPRISE_MODE",
      ok: true,
      detail: process.env.ENTERPRISE_MODE === "true" || process.env.ENTERPRISE_MODE === "1"
        ? "on (API binds localhost by default)"
        : "off — set ENTERPRISE_MODE=true on corp PCs",
    },
  ];
}

async function checkOutbound(): Promise<CheckResult> {
  if (process.env.DOCTOR_SKIP_OUTBOUND === "1") {
    return { name: "Outbound HTTPS", ok: true, detail: "skipped (DOCTOR_SKIP_OUTBOUND=1)" };
  }
  const useCopilot =
    Boolean(process.env.GITHUB_COPILOT_TOKEN?.trim()) ||
    Boolean(process.env.GITHUB_COPILOT_OAUTH_TOKEN?.trim()) ||
    (!process.env.OPENAI_API_KEY?.trim() && Boolean(process.env.GITHUB_TOKEN?.trim()));
  const url = useCopilot ? "https://api.github.com" : "https://api.openai.com/v1/models";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (!useCopilot) {
      headers.Authorization = `Bearer ${process.env.OPENAI_API_KEY || "sk-probe"}`;
    } else if (process.env.GITHUB_TOKEN?.trim() || process.env.GITHUB_COPILOT_OAUTH_TOKEN?.trim()) {
      headers.Authorization = `Bearer ${
        process.env.GITHUB_COPILOT_OAUTH_TOKEN || process.env.GITHUB_TOKEN
      }`;
    }
    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    const ok = res.status === 401 || res.status === 200 || res.status === 429 || res.status === 403;
    const host = useCopilot ? "api.github.com" : "api.openai.com";
    return {
      name: "Outbound HTTPS",
      ok,
      detail: ok
        ? `${host} reachable (HTTP ${res.status})`
        : `${host} returned HTTP ${res.status} — check firewall/proxy`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const host = useCopilot ? "api.github.com" : "api.openai.com";
    return {
      name: "Outbound HTTPS",
      ok: false,
      detail: `Cannot reach ${host} (${msg}). Set HTTPS_PROXY / NODE_EXTRA_CA_CERTS or ask IT to allowlist — see docs/ENTERPRISE-WINDOWS.md`,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  loadEnv();
  console.log("\n=== Agentic platform doctor (enterprise Windows) ===\n");

  const databaseUrl =
    process.env.DATABASE_URL?.trim() || "postgresql://localhost:5432/agent_platform";
  const apiPort = Number(process.env.API_PORT || 8000);

  const results: CheckResult[] = [
    checkNode(),
    ...(await Promise.all([portStatus(apiPort), portStatus(5173)])),
    await checkPostgres(databaseUrl),
    ...checkEnvKeys(),
    await checkOutbound(),
  ];

  let failed = 0;
  for (const r of results) {
    const tag = r.ok ? "OK  " : "FAIL";
    if (!r.ok) failed += 1;
    console.log(`[${tag}] ${r.name}: ${r.detail}`);
  }

  console.log("");
  if (failed) {
    console.log(`${failed} check(s) failed. See docs/ENTERPRISE-WINDOWS.md`);
    process.exit(1);
  }
  console.log("All checks passed. Next: npm run setup:db (if needed), then npm run dev");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
