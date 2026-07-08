import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { RunnableConfig } from "@langchain/core/runnables";
import { getRunContextFromConfig, resolveInWorkspace } from "./context.js";

export const readFile = tool(
  async ({ path }, config: RunnableConfig) => {
    const ctx = getRunContextFromConfig(config);
    const target = resolveInWorkspace(ctx.workspaceDir, path);
    if (!existsSync(target)) return `ERROR: file not found: ${path}`;
    return readFileSync(target, "utf-8");
  },
  {
    name: "read_file",
    description: "Read a file relative to the workspace root.",
    schema: z.object({ path: z.string() }),
  }
);

export const writeFile = tool(
  async ({ path, content }, config: RunnableConfig) => {
    const ctx = getRunContextFromConfig(config);
    const target = resolveInWorkspace(ctx.workspaceDir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf-8");
    return `Wrote ${path} (${content.length} chars)`;
  },
  {
    name: "write_file",
    description: "Write content to a file.",
    schema: z.object({ path: z.string(), content: z.string() }),
  }
);

export const editFile = tool(
  async ({ path, old_string, new_string }, config: RunnableConfig) => {
    const ctx = getRunContextFromConfig(config);
    const target = resolveInWorkspace(ctx.workspaceDir, path);
    if (!existsSync(target)) return `ERROR: file not found: ${path}`;
    const text = readFileSync(target, "utf-8");
    if (!text.includes(old_string)) return `ERROR: old_string not found in ${path}`;
    writeFileSync(target, text.replace(old_string, new_string), "utf-8");
    return `Edited ${path}`;
  },
  {
    name: "edit_file",
    description: "Replace first occurrence of old_string with new_string.",
    schema: z.object({
      path: z.string(),
      old_string: z.string(),
      new_string: z.string(),
    }),
  }
);
