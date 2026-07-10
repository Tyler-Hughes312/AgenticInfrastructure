import type { RunnableConfig } from "@langchain/core/runnables";
import { resolve } from "node:path";

export interface RunContext {
  workspaceDir: string;
  runId: string;
  projectId: string;
  repoUrl: string;
  githubToken: string;
  branch: string;
  chatSessionId?: string;
  sessionScoped?: boolean;
}

const contexts = new Map<string, RunContext>();

export function setRunContext(runId: string, ctx: RunContext): void {
  contexts.set(runId, ctx);
}

export function clearRunContext(runId: string): void {
  contexts.delete(runId);
}

export function getRunContextFromConfig(config?: RunnableConfig): RunContext {
  const runId = config?.configurable?.run_id as string | undefined;
  if (!runId) {
    throw new Error("run_id not set in config.configurable");
  }
  const ctx = contexts.get(runId);
  if (!ctx) {
    throw new Error(`No run context for run_id=${runId}`);
  }
  return ctx;
}

export function patchRunContext(runId: string, patch: Partial<RunContext>): RunContext {
  const ctx = contexts.get(runId);
  if (!ctx) {
    throw new Error(`No run context for run_id=${runId}`);
  }
  const next = { ...ctx, ...patch };
  contexts.set(runId, next);
  return next;
}

export function resolveInWorkspace(workspaceDir: string, relativePath: string): string {
  const base = resolve(workspaceDir);
  const target = resolve(base, relativePath);
  if (!target.startsWith(base)) {
    throw new Error(`Path escapes workspace: ${relativePath}`);
  }
  return target;
}
