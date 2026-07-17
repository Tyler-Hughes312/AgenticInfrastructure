/**
 * Windows/macOS Copilot bootstrap:
 * - copies .env.example → .env if missing
 * - prints next steps / runs device login when --login is passed
 *
 * Usage:
 *   npm run setup:copilot
 *   npm run setup:copilot -- --login
 */
import { existsSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

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
  if (!existsSync(example)) {
    console.error(`[fail] missing ${example}`);
    process.exit(1);
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
  ensure("MODEL_PRIMARY", "copilot:gpt-4o");
  ensure("MODEL_FALLBACK", "copilot:gpt-4.1");
  if (!/^GITHUB_COPILOT_OAUTH_TOKEN=/m.test(text)) {
    text = `${text.trimEnd()}\nGITHUB_COPILOT_OAUTH_TOKEN=\n`;
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

const wantLogin = process.argv.includes("--login");
if (wantLogin) {
  console.log("\nStarting GitHub device login for Copilot…\n");
  const r = spawnSync("npx", ["tsx", "src/auth/copilot-cli.ts"], {
    cwd: serverDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  process.exit(r.status ?? 1);
}

console.log(`
Next steps:
  1. Edit packages/server/.env — set DATABASE_URL for your machine
       Windows: postgresql://postgres:PASSWORD@localhost:5432/agent_platform
       macOS:   postgresql://YOUR_USERNAME@localhost:5432/agent_platform
  2. npm run setup:db
  3. npm run setup:copilot -- --login
  4. npm run doctor
  5. npm run dev

Full guide: docs/COPILOT-SETUP.md
`);
