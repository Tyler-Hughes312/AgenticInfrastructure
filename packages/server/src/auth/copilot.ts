import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../..");
const ENV_FILE = resolve(REPO_ROOT, "packages/server/.env");
const TOKEN_CACHE = resolve(REPO_ROOT, ".copilot_token");

async function requestDeviceCode(): Promise<{
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
}> {
  const res = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { Accept: "application/json" },
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
  }>;
}

async function pollAccessToken(deviceCode: string, interval: number): Promise<string> {
  let wait = interval;
  while (true) {
    await new Promise((r) => setTimeout(r, wait * 1000));
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json" },
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

function updateEnvFile(token: string) {
  const lines = existsSync(ENV_FILE)
    ? readFileSync(ENV_FILE, "utf-8").split("\n")
    : readFileSync(resolve(REPO_ROOT, "packages/server/.env.example"), "utf-8").split("\n");
  const key = "GITHUB_COPILOT_TOKEN";
  let found = false;
  const out = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${token}`;
    }
    return line;
  });
  if (!found) out.push(`${key}=${token}`);
  writeFileSync(ENV_FILE, out.join("\n") + "\n");
}

export async function acquireCopilotToken(writeEnv = true): Promise<string> {
  console.log("Starting GitHub Device Flow for Copilot...");
  const device = await requestDeviceCode();
  console.log(`\nVisit: ${device.verification_uri}`);
  console.log(`Code:  ${device.user_code}\n`);
  const githubToken = await pollAccessToken(device.device_code, device.interval);
  const copilotToken = await exchangeCopilotToken(githubToken);
  writeFileSync(TOKEN_CACHE, copilotToken);
  if (writeEnv) updateEnvFile(copilotToken);
  console.log("Copilot token acquired.");
  return copilotToken;
}
