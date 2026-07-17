/**
 * Windows/macOS/Linux Copilot bootstrap.
 *
 *   npm run setup:copilot
 *   npm run setup:copilot -- --login   # device code → tokens auto-written to .env
 */
import { existsSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(__dirname, "..");
const repoRoot = resolve(serverDir, "../..");
const webDir = resolve(repoRoot, "packages/web");

const serverEnv = resolve(serverDir, ".env");
const serverExample = resolve(serverDir, ".env.example");
const webEnv = resolve(webDir, ".env.local");
const webExample = resolve(webDir, ".env.example");

function ensureEnv(target: string, example: string, label: string) {
  if (existsSync(target)) {
    console.log(`[ok] ${label} already exists`);
    return;
  }
  copyFileSync(example, target);
  console.log(`[ok] created ${label} from example`);
}

function patchModelDefaults(envPath: string) {
  if (!existsSync(envPath)) return;
  let text = readFileSync(envPath, "utf-8");
  const ensure = (key: string, value: string) => {
    if (new RegExp(`^${key}=`, "m").test(text)) {
      text = text.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`);
    } else {
      text = `${text.trimEnd()}\n${key}=${value}\n`;
    }
  };
  ensure("MODEL_PRIMARY", "bedrock:openai.gpt-oss-120b-1:0");
  ensure("MODEL_FALLBACK", "bedrock:openai.gpt-oss-120b-1:0");
  ensure("BEDROCK_ENABLED", "true");
  ensure("BEDROCK_REGION", "us-gov-west-1");
  ensure("BEDROCK_MODEL_ID", "openai.gpt-oss-120b-1:0");
  if (!/^GITHUB_COPILOT_OAUTH_TOKEN=/m.test(text)) {
    text = `${text.trimEnd()}\nGITHUB_COPILOT_OAUTH_TOKEN=\n`;
  }
  if (!/^GITHUB_COPILOT_TOKEN=/m.test(text)) {
    text = `${text.trimEnd()}\nGITHUB_COPILOT_TOKEN=\n`;
  }
  writeFileSync(envPath, text.endsWith("\n") ? text : `${text}\n`);
}

console.log("\n=== Copilot setup bootstrap ===\n");
ensureEnv(serverEnv, serverExample, "packages/server/.env");
ensureEnv(webEnv, webExample, "packages/web/.env.local");
patchModelDefaults(serverEnv);
if (existsSync(resolve(repoRoot, ".env"))) {
  patchModelDefaults(resolve(repoRoot, ".env"));
  console.log("[ok] patched repo-root .env model defaults (overrides server .env)");
}

const wantLogin =
  process.argv.includes("--login") ||
  process.argv.includes("login") ||
  process.env.COPILOT_LOGIN === "1";
if (wantLogin) {
  console.log("\nGitHub device login — tokens will be written to .env automatically.\n");
  const { acquireCopilotToken } = await import("../src/auth/copilot.js");
  await acquireCopilotToken(true);
  process.exit(0);
}

console.log(`
Next steps:
  1. Edit packages/server/.env DATABASE_URL if needed
  2. npm run setup:db
  3. npm run setup:copilot -- --login
       → open GitHub, enter the code, tokens land in packages/server/.env
  4. npm run doctor
  5. npm run test:e2e
  6. npm run dev

Or start from a clean minimal profile: npm run setup:minimal
Guide: docs/COPILOT-SETUP.md
`);
