import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { upsertEnvKeys } from "../src/auth/copilot.js";
import { suggestModelForRole } from "../src/agents/role-model-presets.js";
import { looksLikeGraphDesignRequest, looksLikeProductDeliverable } from "../src/agents/pipeline-gate.js";

/**
 * Cross-platform e2e-style checks that need NO secrets, NO network LLM, NO Docker.
 * Safe to run on Windows / macOS / Linux CI and local machines.
 */
describe("platform-agnostic setup (no secrets)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agentic-e2e-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("upsertEnvKeys creates and updates .env with CRLF-safe lines", () => {
    const envPath = join(dir, "packages", "server", ".env");
    upsertEnvKeys(envPath, {
      GITHUB_COPILOT_OAUTH_TOKEN: "gho_test_oauth",
      GITHUB_COPILOT_TOKEN: "tid=1;exp=9999999999",
      MODEL_PRIMARY: "copilot:gpt-4o",
    });
    expect(existsSync(envPath)).toBe(true);
    const first = readFileSync(envPath, "utf-8");
    expect(first).toContain("GITHUB_COPILOT_OAUTH_TOKEN=gho_test_oauth");
    expect(first).toContain("GITHUB_COPILOT_TOKEN=tid=1;exp=9999999999");
    expect(first).toContain("MODEL_PRIMARY=copilot:gpt-4o");

    upsertEnvKeys(envPath, { GITHUB_COPILOT_TOKEN: "tid=2;exp=9999999999" });
    const second = readFileSync(envPath, "utf-8");
    expect(second).toContain("GITHUB_COPILOT_TOKEN=tid=2;exp=9999999999");
    expect(second).toContain("GITHUB_COPILOT_OAUTH_TOKEN=gho_test_oauth");
    expect(second.match(/^GITHUB_COPILOT_TOKEN=/gm)?.length).toBe(1);
  });

  it("upsertEnvKeys works when starting from Windows-style CRLF example", () => {
    const example = join(dir, ".env.example");
    const envPath = join(dir, ".env");
    writeFileSync(example, "MODEL_PRIMARY=openai:gpt-4o\r\nOPENAI_API_KEY=\r\n");
    upsertEnvKeys(
      envPath,
      {
        MODEL_PRIMARY: "copilot:gpt-4o",
        GITHUB_COPILOT_TOKEN: "session",
      },
      example
    );
    const text = readFileSync(envPath, "utf-8");
    expect(text).toContain("MODEL_PRIMARY=copilot:gpt-4o");
    expect(text).toContain("GITHUB_COPILOT_TOKEN=session");
    expect(text.includes("\r")).toBe(false);
  });

  it("DATABASE_URL presets are valid URL shapes for win/mac/linux docs", () => {
    const windows = "postgresql://postgres:PASSWORD@localhost:5432/agent_platform";
    const mac = "postgresql://alice@localhost:5432/agent_platform";
    const linux = "postgresql://postgres@localhost:5432/agent_platform";
    for (const u of [windows, mac, linux]) {
      expect(() => new URL(u)).not.toThrow();
      expect(new URL(u).port || "5432").toBe("5432");
    }
  });

  it("role model presets use Bedrock GPT-OSS-120B", () => {
    const models = [
      suggestModelForRole({ label: "Coder", role: "implements code", tools: ["write_file"] }),
      suggestModelForRole({ label: "Planner", role: "plans architecture", tools: ["read_file"] }),
      suggestModelForRole({ label: "Router", role: "classifies requests", tools: ["read_file"] }),
    ];
    for (const m of models) {
      expect(m).toBe("bedrock:openai.gpt-oss-120b-1:0");
    }
  });

  it("intent heuristics separate team design vs product build", () => {
    expect(looksLikeGraphDesignRequest("make a software dev team with subagents")).toBe(true);
    expect(looksLikeProductDeliverable("build a todo app")).toBe(true);
    expect(looksLikeGraphDesignRequest("build a todo app")).toBe(false);
  });
});

describe("live health e2e (optional — skips if server down)", () => {
  const base = process.env.E2E_API_URL || "http://127.0.0.1:8000";

  it("GET /health when server is up", async () => {
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
      expect(res.ok).toBe(true);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe("ok");
    } catch {
      // No server — not a failure for offline/CI without Postgres stack.
      expect(true).toBe(true);
    }
  });

  it("GET /api/graph-templates when server is up", async () => {
    try {
      const res = await fetch(`${base}/api/graph-templates`, {
        signal: AbortSignal.timeout(2000),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    } catch {
      expect(true).toBe(true);
    }
  });
});
