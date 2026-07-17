import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(__dirname, "..");
const repoRoot = resolve(serverDir, "../..");

/**
 * Load env for local/dev testing:
 * 1) packages/server/.env — package defaults (DB, ports, etc.)
 * 2) repo-root .env — shared secrets override for temporary testing
 */
function loadEnvFiles() {
  const serverEnv = resolve(serverDir, ".env");
  const rootEnv = resolve(repoRoot, ".env");

  if (existsSync(serverEnv)) {
    dotenv.config({ path: serverEnv });
  }
  if (existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv, override: true });
  }

  // Langfuse cloud often uses LANGFUSE_BASE_URL; our code expects LANGFUSE_HOST.
  const baseUrl = process.env.LANGFUSE_BASE_URL?.trim();
  if (baseUrl) {
    process.env.LANGFUSE_HOST = baseUrl;
  }
}

loadEnvFiles();

const envSchema = z.object({
  MODEL_PRIMARY: z.string().default("bedrock:openai.gpt-oss-120b-1:0"),
  MODEL_FALLBACK: z.string().default("bedrock:openai.gpt-oss-120b-1:0"),
  /** When true (or AWS creds present), bedrock: models are eligible. */
  BEDROCK_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v !== "0" && v.toLowerCase() !== "false"),
  BEDROCK_REGION: z.string().default("us-gov-west-1"),
  BEDROCK_MODEL_ID: z.string().default("openai.gpt-oss-120b-1:0"),
  GITHUB_COPILOT_TOKEN: z.string().default(""),
  /** Long-lived OAuth token from copilot-login — used to refresh session tokens. */
  GITHUB_COPILOT_OAUTH_TOKEN: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
  EMBEDDING_MODEL: z.string().default("openai:text-embedding-3-small"),
  DATABASE_URL: z
    .string()
    .default("postgresql://localhost:5432/agent_platform")
    .refine(
      (url) => {
        try {
          const u = new URL(url);
          // Reject common Docker Compose Postgres defaults (pgvector on 5433, etc.)
          if (u.port === "5433") return false;
          if (u.password === "postgres" && (u.username === "postgres" || !u.username)) return false;
          return true;
        } catch {
          return true;
        }
      },
      {
        message:
          "DATABASE_URL looks like a Docker Postgres URL. Use local Postgres on port 5432, e.g. postgresql://postgres:PASSWORD@localhost:5432/agent_platform (Windows) or postgresql://YOUR_USERNAME@localhost:5432/agent_platform (macOS)",
      }
    ),
  GITHUB_TOKEN: z.string().default(""),
  LANGFUSE_PUBLIC_KEY: z.string().default(""),
  LANGFUSE_SECRET_KEY: z.string().default(""),
  LANGFUSE_HOST: z.string().default("http://localhost:3000"),
  CORS_ORIGINS: z.string().default("http://localhost:5173,http://127.0.0.1:5173"),
  /** When true, prefer binding API to 127.0.0.1 (corp Windows default). */
  ENTERPRISE_MODE: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().default(8000),
  WORKSPACE_ROOT: z.string().default(".workspaces"),
  MEMORY_STORE: z.enum(["postgres", "inmemory"]).default("inmemory"),
  DEFAULT_REPO_URL: z.string().default(""),
  DEFAULT_PROJECT_NAME: z.string().default("default"),
  HTTPS_PROXY: z.string().default(""),
  HTTP_PROXY: z.string().default(""),
  NO_PROXY: z.string().default(""),
  NODE_EXTRA_CA_CERTS: z.string().default(""),
});

export const env = envSchema.parse(process.env);

/** Effective listen host — localhost when ENTERPRISE_MODE forces it. */
export function getListenHost(): string {
  if (env.ENTERPRISE_MODE && (env.API_HOST === "0.0.0.0" || env.API_HOST === "::")) {
    return "127.0.0.1";
  }
  return env.API_HOST;
}

export const corsOrigins = env.CORS_ORIGINS.split(",")
  .map((o) => o.trim())
  .filter(Boolean);

/** Safe startup summary — never logs secret values. */
export function logEnvSummary(): void {
  const sources = [
    existsSync(resolve(serverDir, ".env")) ? "packages/server/.env" : null,
    existsSync(resolve(repoRoot, ".env")) ? ".env (repo root, overrides)" : null,
  ].filter(Boolean);

  console.log(
    `[env] loaded from: ${sources.length ? sources.join(" → ") : "(defaults only)"}`
  );
  console.log(
    `[env] openai=${Boolean(env.OPENAI_API_KEY)} github=${Boolean(env.GITHUB_TOKEN)} ` +
      `copilot=${Boolean(env.GITHUB_COPILOT_TOKEN)} copilot_oauth=${Boolean(env.GITHUB_COPILOT_OAUTH_TOKEN)} ` +
      `langfuse=${Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY)} ` +
      `primary=${env.MODEL_PRIMARY}`
  );
  try {
    const db = new URL(env.DATABASE_URL);
    console.log(
      `[env] db=${db.hostname}:${db.port || "5432"}${db.pathname} user=${db.username || "(peer)"} memory=${env.MEMORY_STORE}`
    );
  } catch {
    console.log(`[env] db=(unparseable DATABASE_URL) memory=${env.MEMORY_STORE}`);
  }
  console.log(
    `[env] enterprise=${env.ENTERPRISE_MODE} listen=${getListenHost()}:${env.API_PORT} workspace=${env.WORKSPACE_ROOT}`
  );
}
