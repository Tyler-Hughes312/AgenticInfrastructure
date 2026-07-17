import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import { platform } from "node:os";

const COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, "../../../..");
export const SERVER_ENV_FILE = resolve(REPO_ROOT, "packages/server/.env");
export const SERVER_ENV_EXAMPLE = resolve(REPO_ROOT, "packages/server/.env.example");
export const ROOT_ENV_FILE = resolve(REPO_ROOT, ".env");
const TOKEN_CACHE = resolve(REPO_ROOT, ".copilot_token");
const OAUTH_CACHE = resolve(REPO_ROOT, ".copilot_oauth");

async function requestDeviceCode(): Promise<{
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
  expires_in?: number;
}> {
  const res = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: COPILOT_CLIENT_ID,
      scope: "read:user",
    }),
  });
  if (!res.ok) throw new Error(`Device code request failed: ${await res.text()}`);
  return res.json() as Promise<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    interval: number;
    expires_in?: number;
  }>;
}

async function pollAccessToken(deviceCode: string, interval: number): Promise<string> {
  let wait = Math.max(interval || 5, 1);
  while (true) {
    await new Promise((r) => setTimeout(r, wait * 1000));
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: COPILOT_CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const data = (await res.json()) as { access_token?: string; error?: string };
    if (data.access_token) return data.access_token;
    if (data.error === "slow_down") wait += 5;
    else if (data.error !== "authorization_pending") {
      throw new Error(`Device flow failed: ${JSON.stringify(data)}`);
    }
  }
}

export async function exchangeCopilotToken(githubToken: string): Promise<string> {
  const res = await fetch("https://api.github.com/copilot_internal/v2/token", {
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: "application/json",
      "Editor-Version": "vscode/1.85.0",
      "Editor-Plugin-Version": "copilot-chat/0.1.0",
    },
  });
  if (!res.ok) throw new Error(`Copilot token exchange failed: ${await res.text()}`);
  const data = (await res.json()) as { token: string };
  return data.token;
}

/** Upsert KEY=value lines in an env file (creates from example or empty). */
export function upsertEnvKeys(
  envPath: string,
  updates: Record<string, string>,
  examplePath?: string
): void {
  mkdirSync(dirname(envPath), { recursive: true });
  let lines: string[];
  if (existsSync(envPath)) {
    lines = readFileSync(envPath, "utf-8").split(/\r?\n/);
  } else if (examplePath && existsSync(examplePath)) {
    lines = readFileSync(examplePath, "utf-8").split(/\r?\n/);
  } else {
    lines = [];
  }

  // Drop trailing empty line so we control final newline.
  while (lines.length && lines[lines.length - 1] === "") lines.pop();

  const found = new Set<string>();
  const out = lines.map((line) => {
    for (const [key, value] of Object.entries(updates)) {
      if (line.startsWith(`${key}=`)) {
        found.add(key);
        return `${key}=${value}`;
      }
    }
    return line;
  });
  for (const [key, value] of Object.entries(updates)) {
    if (!found.has(key)) out.push(`${key}=${value}`);
  }
  writeFileSync(envPath, `${out.join("\n")}\n`);
}

/** Write OAuth + session tokens into packages/server/.env and repo-root .env if present. */
export function writeCopilotTokensToEnv(oauthToken: string, sessionToken: string): string[] {
  const updates = {
    GITHUB_COPILOT_OAUTH_TOKEN: oauthToken,
    GITHUB_COPILOT_TOKEN: sessionToken,
    MODEL_PRIMARY: "copilot:gpt-4o",
    MODEL_FALLBACK: "copilot:gpt-4.1",
  };
  const written: string[] = [];
  upsertEnvKeys(SERVER_ENV_FILE, updates, SERVER_ENV_EXAMPLE);
  written.push(SERVER_ENV_FILE);
  if (existsSync(ROOT_ENV_FILE)) {
    upsertEnvKeys(ROOT_ENV_FILE, updates);
    written.push(ROOT_ENV_FILE);
  }
  return written;
}

function openInBrowser(url: string): void {
  const p = platform();
  const cmd =
    p === "darwin" ? `open "${url}"` : p === "win32" ? `start "" "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {
    /* best-effort */
  });
}

export async function acquireCopilotToken(writeEnv = true): Promise<string> {
  console.log("Starting GitHub Device Flow for Copilot…");
  const device = await requestDeviceCode();
  const verifyUrl = device.verification_uri || "https://github.com/login/device";
  console.log(`\n1) Open:  ${verifyUrl}`);
  console.log(`2) Enter: ${device.user_code}`);
  console.log(`\nWaiting for you to authorize in the browser…\n`);
  openInBrowser(verifyUrl);

  const oauthToken = await pollAccessToken(device.device_code, device.interval);
  console.log("GitHub OAuth approved. Exchanging for Copilot session token…");
  const copilotToken = await exchangeCopilotToken(oauthToken);

  writeFileSync(OAUTH_CACHE, oauthToken);
  writeFileSync(TOKEN_CACHE, copilotToken);

  if (writeEnv) {
    const paths = writeCopilotTokensToEnv(oauthToken, copilotToken);
    console.log("\nWrote tokens automatically to:");
    for (const p of paths) console.log(`  - ${p}`);
    console.log("Keys: GITHUB_COPILOT_OAUTH_TOKEN, GITHUB_COPILOT_TOKEN, MODEL_PRIMARY, MODEL_FALLBACK");
  }

  console.log("\nCopilot login complete. Restart the server if it is already running:");
  console.log("  npm run dev\n");
  return copilotToken;
}
