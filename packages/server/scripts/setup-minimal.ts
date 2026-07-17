/**
 * Minimal cross-platform bootstrap — no secrets, no Docker, no Langfuse/OpenAI required.
 *
 *   npm run setup:minimal
 *   npm run setup:copilot -- --login   # GitHub device code → tokens auto-written to .env
 *   npm run setup:db
 *   npm run doctor
 *   npm run dev
 */
import { existsSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, platform, userInfo } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(__dirname, "..");
const repoRoot = resolve(serverDir, "../..");
const webDir = resolve(repoRoot, "packages/web");

const serverEnv = resolve(serverDir, ".env");
const serverExample = resolve(serverDir, ".env.example");
const webEnv = resolve(webDir, ".env.local");
const webExample = resolve(webDir, ".env.example");

function ensureCopy(target: string, example: string, label: string) {
  if (existsSync(target)) {
    console.log(`[ok] ${label}`);
    return false;
  }
  copyFileSync(example, target);
  console.log(`[created] ${label}`);
  return true;
}

function setKey(text: string, key: string, value: string): string {
  if (new RegExp(`^${key}=`, "m").test(text)) {
    return text.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`);
  }
  return `${text.trimEnd()}\n${key}=${value}\n`;
}

function defaultDatabaseUrl(): string {
  const p = platform();
  if (p === "win32") {
    return "postgresql://postgres:YOUR_PASSWORD@localhost:5432/agent_platform";
  }
  const user = userInfo().username || "postgres";
  return `postgresql://${user}@localhost:5432/agent_platform`;
}

function getKey(text: string, key: string): string | undefined {
  const m = text.match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1] : undefined;
}

function patchMinimal(envPath: string) {
  let text = readFileSync(envPath, "utf-8");
  text = setKey(text, "MODEL_PRIMARY", "bedrock:openai.gpt-oss-120b-1:0");
  text = setKey(text, "MODEL_FALLBACK", "bedrock:openai.gpt-oss-120b-1:0");
  text = setKey(text, "BEDROCK_ENABLED", "true");
  text = setKey(text, "BEDROCK_REGION", "us-gov-west-1");
  text = setKey(text, "BEDROCK_MODEL_ID", "openai.gpt-oss-120b-1:0");
  text = setKey(text, "MEMORY_STORE", "inmemory");
  // Do not clear existing secrets — only ensure Copilot keys exist (may be empty until login).
  if (!/^GITHUB_COPILOT_OAUTH_TOKEN=/m.test(text)) {
    text = setKey(text, "GITHUB_COPILOT_OAUTH_TOKEN", "");
  }
  if (!/^GITHUB_COPILOT_TOKEN=/m.test(text)) {
    text = setKey(text, "GITHUB_COPILOT_TOKEN", "");
  }
  const db = getKey(text, "DATABASE_URL") ?? "";
  if (!db || /YOUR_PASSWORD|YOUR_USERNAME|YOUR_MAC_USERNAME/.test(db)) {
    text = setKey(text, "DATABASE_URL", defaultDatabaseUrl());
  }
  if (platform() === "win32") {
    text = setKey(text, "ENTERPRISE_MODE", "true");
    text = setKey(text, "API_HOST", "127.0.0.1");
    const ws = resolve(homedir(), "AppData", "Local", "agentic-platform", "workspaces");
    if (!getKey(text, "WORKSPACE_ROOT")) {
      text = setKey(text, "WORKSPACE_ROOT", ws);
    }
  }
  writeFileSync(envPath, text.endsWith("\n") ? text : `${text}\n`);
}

console.log("\n=== Minimal setup (no secrets required yet) ===\n");
console.log(`platform: ${platform()}  user: ${userInfo().username}`);

ensureCopy(serverEnv, serverExample, "packages/server/.env");
ensureCopy(webEnv, webExample, "packages/web/.env.local");
patchMinimal(serverEnv);
console.log("[ok] Copilot-first defaults, Langfuse/OpenAI cleared, MEMORY_STORE=inmemory");

console.log(`
Next (required for LLM):
  npm run setup:copilot -- --login
    → browser opens GitHub device login
    → enter the code shown in the terminal
    → GITHUB_COPILOT_* tokens are written into packages/server/.env automatically

Then:
  npm run setup:db
  npm run doctor
  npm run test:e2e
  npm run dev

Docs: docs/COPILOT-SETUP.md
`);
