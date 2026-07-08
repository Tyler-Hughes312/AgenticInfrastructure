import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { RunnableConfig } from "@langchain/core/runnables";
import { getRunContextFromConfig } from "./context.js";

/** Sentinel repo URL for orchestrator sessions that do not use a git remote. */
export const LOCAL_WORKSPACE_REPO = "local://workspace";

export function isRemoteRepo(repoUrl: string | null | undefined): boolean {
  const url = (repoUrl ?? "").trim();
  return Boolean(url) && !url.startsWith("local://");
}

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
  try {
    const out = execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
    });
    return { ok: true, out };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    return { ok: false, out: [e.stdout, e.stderr].filter(Boolean).join("\n") };
  }
}

export function cloneRepo(repoUrl: string, dest: string): void {
  execSync(`git clone ${repoUrl} ${dest}`, { encoding: "utf-8" });
}

/** Prepare a run workspace: empty local dir, or git clone when a remote repo is configured. */
export function prepareWorkspace(repoUrl: string, dest: string): void {
  if (!isRemoteRepo(repoUrl)) {
    mkdirSync(dest, { recursive: true });
    return;
  }
  if (existsSync(dest)) return;
  cloneRepo(repoUrl, dest);
}

export const gitCreateBranch = tool(
  async ({ name }, config: RunnableConfig) => {
    const ctx = getRunContextFromConfig(config);
    const result = git(ctx.workspaceDir, ["checkout", "-b", name]);
    return result.ok ? `Checked out branch ${name}` : `ERROR: ${result.out}`;
  },
  {
    name: "git_create_branch",
    description: "Create and checkout a new git branch.",
    schema: z.object({ name: z.string() }),
  }
);

export const gitDiff = tool(
  async (_input, config: RunnableConfig) => {
    const ctx = getRunContextFromConfig(config);
    const tracked = git(ctx.workspaceDir, ["diff", "HEAD"]);
    const untracked = git(ctx.workspaceDir, ["ls-files", "--others", "--exclude-standard"]);
    const out = [tracked.out, untracked.out.trim()].filter(Boolean).join("\n");
    return out || "(no diff)";
  },
  {
    name: "git_diff",
    description: "Show git diff in the workspace.",
    schema: z.object({}),
  }
);

export const gitCommit = tool(
  async ({ message }, config: RunnableConfig) => {
    const ctx = getRunContextFromConfig(config);
    git(ctx.workspaceDir, ["add", "-A"]);
    const result = git(ctx.workspaceDir, ["commit", "-m", message]);
    return result.ok ? result.out.trim() || "Committed." : `ERROR: ${result.out}`;
  },
  {
    name: "git_commit",
    description: "Stage all and commit.",
    schema: z.object({ message: z.string() }),
  }
);

export const gitPush = tool(
  async ({ branch }, config: RunnableConfig) => {
    const ctx = getRunContextFromConfig(config);
    const b = branch || ctx.branch;
    const result = git(ctx.workspaceDir, ["push", "-u", "origin", b]);
    return result.ok ? result.out.trim() || `Pushed ${b}` : `ERROR: ${result.out}`;
  },
  {
    name: "git_push",
    description: "Push branch to origin.",
    schema: z.object({ branch: z.string().optional() }),
  }
);
