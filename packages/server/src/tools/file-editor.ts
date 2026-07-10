import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { RunnableConfig } from "@langchain/core/runnables";
import { getRunContextFromConfig, resolveInWorkspace } from "./context.js";
import { recordFileChange } from "../services/workspace-service.js";
import { AGENT_OUTPUT_FORMATS_HELP, extensionOf, isTextFile } from "./file-types.js";
import { textToDocxBuffer } from "./docx-writer.js";

function agentIdFromConfig(config?: RunnableConfig): string {
  const meta = config?.metadata as Record<string, unknown> | undefined;
  const node = meta?.langgraph_node;
  if (typeof node === "string" && node && node !== "supervisor") return node;
  return "unknown_agent";
}

async function maybeRecordChange(
  config: RunnableConfig,
  params: {
    path: string;
    action: "write" | "edit";
    beforeText: string;
    afterText: string;
  }
): Promise<void> {
  const ctx = getRunContextFromConfig(config);
  if (!ctx.chatSessionId) return;
  try {
    await recordFileChange({
      chatSessionId: ctx.chatSessionId,
      runId: ctx.runId,
      agentId: agentIdFromConfig(config),
      path: params.path,
      action: params.action,
      beforeText: params.beforeText,
      afterText: params.afterText,
    });
  } catch (err) {
    console.warn("Failed to record file change:", err);
  }
}

export const readFile = tool(
  async ({ path }, config: RunnableConfig) => {
    const ctx = getRunContextFromConfig(config);
    const target = resolveInWorkspace(ctx.workspaceDir, path);
    if (!existsSync(target)) return `ERROR: file not found: ${path}`;
    if (!isTextFile(path)) {
      const buf = readFileSync(target);
      return `[Binary file ${path}, ${buf.length} bytes — not displayed. Use shell or download from Code IDE.]`;
    }
    return readFileSync(target, "utf-8");
  },
  {
    name: "read_file",
    description:
      "Read a UTF-8 text file relative to the workspace root. " + AGENT_OUTPUT_FORMATS_HELP,
    schema: z.object({ path: z.string() }),
  }
);

export const writeFile = tool(
  async ({ path, content }, config: RunnableConfig) => {
    const ctx = getRunContextFromConfig(config);
    const target = resolveInWorkspace(ctx.workspaceDir, path);
    const ext = extensionOf(path);
    const beforeText =
      existsSync(target) && isTextFile(path) ? readFileSync(target, "utf-8") : "";

    mkdirSync(dirname(target), { recursive: true });

    if (ext === "docx") {
      const buf = await textToDocxBuffer(content);
      writeFileSync(target, buf);
      await maybeRecordChange(config, {
        path,
        action: "write",
        beforeText,
        afterText: `[Word document generated, ${buf.length} bytes]\n\nSource text:\n${content.slice(0, 8000)}`,
      });
      return `Wrote Word document ${path} (${buf.length} bytes)`;
    }

    writeFileSync(target, content, "utf-8");
    await maybeRecordChange(config, {
      path,
      action: "write",
      beforeText,
      afterText: content,
    });
    return `Wrote ${path} (${content.length} chars)`;
  },
  {
    name: "write_file",
    description:
      "Write or overwrite a file in the workspace. " +
      "Use for code, markdown, HTML, JSON, CSV, plain text, or .docx (content is converted to Word). " +
      AGENT_OUTPUT_FORMATS_HELP,
    schema: z.object({ path: z.string(), content: z.string() }),
  }
);

export const writeDocument = tool(
  async ({ path, content, title }, config: RunnableConfig) => {
    const ctx = getRunContextFromConfig(config);
    const target = resolveInWorkspace(ctx.workspaceDir, path);
    const ext = extensionOf(path);
    const beforeText = existsSync(target) && isTextFile(path) ? readFileSync(target, "utf-8") : "";
    mkdirSync(dirname(target), { recursive: true });

    let body = content;
    if (title?.trim() && (ext === "md" || ext === "markdown" || ext === "html")) {
      body =
        ext === "html"
          ? `<!DOCTYPE html><html><head><title>${title}</title></head><body>${content}</body></html>`
          : `# ${title.trim()}\n\n${content}`;
    }

    if (ext === "docx") {
      const docBody = title?.trim() ? `${title.trim()}\n\n${content}` : content;
      const buf = await textToDocxBuffer(docBody);
      writeFileSync(target, buf);
      await maybeRecordChange(config, {
        path,
        action: "write",
        beforeText,
        afterText: `[Word document: ${title ?? path}]\n\n${docBody.slice(0, 8000)}`,
      });
      return `Wrote document ${path} (${buf.length} bytes)`;
    }

    writeFileSync(target, body, "utf-8");
    await maybeRecordChange(config, {
      path,
      action: "write",
      beforeText,
      afterText: body,
    });
    return `Wrote document ${path} (${body.length} chars)`;
  },
  {
    name: "write_document",
    description:
      "Write a user-facing document (essay, report, spec, README). " +
      "Prefer docs/ or output/ paths. Formats: .md, .txt, .html, .docx, .csv, .json. " +
      "Optional title adds a heading (markdown/html) or document title (docx).",
    schema: z.object({
      path: z.string(),
      content: z.string(),
      title: z.string().optional(),
    }),
  }
);

export const editFile = tool(
  async ({ path, old_string, new_string }, config: RunnableConfig) => {
    const ctx = getRunContextFromConfig(config);
    const target = resolveInWorkspace(ctx.workspaceDir, path);
    if (!existsSync(target)) return `ERROR: file not found: ${path}`;
    if (!isTextFile(path)) {
      return `ERROR: cannot edit binary file ${path} with edit_file — use write_file to replace.`;
    }
    const beforeText = readFileSync(target, "utf-8");
    if (!beforeText.includes(old_string)) return `ERROR: old_string not found in ${path}`;
    const afterText = beforeText.replace(old_string, new_string);
    writeFileSync(target, afterText, "utf-8");
    await maybeRecordChange(config, {
      path,
      action: "edit",
      beforeText,
      afterText,
    });
    return `Edited ${path}`;
  },
  {
    name: "edit_file",
    description: "Replace first occurrence of old_string with new_string in a text file.",
    schema: z.object({
      path: z.string(),
      old_string: z.string(),
      new_string: z.string(),
    }),
  }
);
