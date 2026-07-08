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
  MODEL_PRIMARY: z.string().default("openai:gpt-4o"),
  MODEL_FALLBACK: z.string().default("openai:gpt-4.1"),
  GITHUB_COPILOT_TOKEN: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
  EMBEDDING_MODEL: z.string().default("openai:text-embedding-3-small"),
  DATABASE_URL: z
    .string()
    .default("postgresql://postgres:postgres@localhost:5432/agent_platform"),
  GITHUB_TOKEN: z.string().default(""),
  LANGFUSE_PUBLIC_KEY: z.string().default(""),
  LANGFUSE_SECRET_KEY: z.string().default(""),
  LANGFUSE_HOST: z.string().default("http://localhost:3000"),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().default(8000),
  WORKSPACE_ROOT: z.string().default(".workspaces"),
  MEMORY_STORE: z.enum(["postgres", "inmemory"]).default("postgres"),
  DEFAULT_REPO_URL: z.string().default(""),
  DEFAULT_PROJECT_NAME: z.string().default("default"),
});

export const env = envSchema.parse(process.env);

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
      `copilot=${Boolean(env.GITHUB_COPILOT_TOKEN)} langfuse=${Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY)} ` +
      `primary=${env.MODEL_PRIMARY}`
  );
}
