import { execSync } from "node:child_process";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { RunnableConfig } from "@langchain/core/runnables";
import { getRunContextFromConfig } from "./context.js";

const MAX_OUTPUT = 32_000;
const TIMEOUT_MS = 120_000;

export const shellTool = tool(
  async ({ command }, config: RunnableConfig) => {
    const ctx = getRunContextFromConfig(config);
    try {
      const output = execSync(command, {
        cwd: ctx.workspaceDir,
        encoding: "utf-8",
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT * 2,
      });
      return output.slice(0, MAX_OUTPUT);
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; status?: number; message?: string };
      const text = [e.stdout, e.stderr, e.message].filter(Boolean).join("\n");
      return `EXIT ${e.status ?? 1}\n${text.slice(0, MAX_OUTPUT)}`;
    }
  },
  {
    name: "shell_tool",
    description: "Run a shell command in the run workspace.",
    schema: z.object({ command: z.string() }),
  }
);
