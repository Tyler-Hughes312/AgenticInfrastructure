import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import type { RunnableConfig } from "@langchain/core/runnables";
import { getStore } from "../db.js";
import { getRunContextFromConfig } from "../tools/context.js";

function projectNamespace(projectId: string): string[] {
  return ["project_memories", projectId];
}

export const manageMemory = tool(
  async ({ action, key, content }, config: RunnableConfig) => {
    const ctx = getRunContextFromConfig(config);
    const store = getStore();
    const ns = projectNamespace(ctx.projectId);
    const memKey = key || uuidv4();
    if (action === "delete") {
      await store.delete(ns, memKey);
      return `Deleted memory ${memKey}`;
    }
    await store.put(ns, memKey, {
      text: content,
      createdAt: new Date().toISOString(),
    });
    return `Stored memory: ${content.slice(0, 100)}`;
  },
  {
    name: "manage_memory",
    description:
      "Create, update, or delete a project memory. Use to record conventions, decisions, and lessons learned.",
    schema: z.object({
      action: z.enum(["create", "update", "delete"]),
      key: z.string().default(""),
      content: z.string().default(""),
    }),
  }
);

export const searchMemory = tool(
  async ({ query, limit }, config: RunnableConfig) => {
    const ctx = getRunContextFromConfig(config);
    const store = getStore();
    const ns = projectNamespace(ctx.projectId);
    const results = await store.search(ns, { query, limit: limit ?? 5 });
    if (!results.length) return "No memories found.";
    return results
      .map((r, i) => `${i + 1}. ${JSON.stringify(r.value)}`)
      .join("\n");
  },
  {
    name: "search_memory",
    description: "Search project memories by semantic similarity.",
    schema: z.object({
      query: z.string(),
      limit: z.number().optional(),
    }),
  }
);
