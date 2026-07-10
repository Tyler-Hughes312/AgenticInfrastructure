import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { RunnableConfig } from "@langchain/core/runnables";
import { env } from "../config.js";
import { getRunContextFromConfig } from "./context.js";

/** Sentinel repo URL for orchestrator sessions that do not use a git remote. */
export const LOCAL_WORKSPACE_REPO = "local://workspace";

export function isRemoteRepo(repoUrl: string | null | undefined): boolean {
  const url = (repoUrl ?? "").trim();
  return Boolean(url) && !url.startsWith("local://");
}

/** Embed a GitHub PAT into an HTTPS remote URL for non-interactive push. */
export function embedTokenInHttpsUrl(url: string, token: string): string {
  const trimmed = url.trim();
  if (!trimmed.startsWith("https://") || !token) return trimmed;
  if (trimmed.includes("@")) return trimmed;
  return trimmed.replace(/^https:\/\//, `https://x-access-token:${token}@`);
}

function gitRemoteUrl(cwd: string): string | null {
  const result = git(cwd, ["remote", "get-url", "origin"]);
  return result.ok ? result.out.trim() : null;
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

/** Initialize a local git workspace (no remote yet). Safe to call repeatedly. */
export function initLocalGitWorkspace(dest: string, branch = "main"): void {
  mkdirSync(dest, { recursive: true });
  const gitDir = join(dest, ".git");
  if (!existsSync(gitDir)) {
    const init = git(dest, ["init", "-b", branch]);
    if (!init.ok) {
      git(dest, ["init"]);
      git(dest, ["checkout", "-b", branch]);
    }
    git(dest, ["config", "user.email", "agent@agentic.local"]);
    git(dest, ["config", "user.name", "Agent Platform"]);
  }
}

/** Point origin at a remote URL (replaces existing origin if present). */
export function linkRemoteOrigin(dest: string, remoteUrl: string): void {
  git(dest, ["remote", "remove", "origin"]);
  const add = git(dest, ["remote", "add", "origin", remoteUrl]);
  if (!add.ok) {
    git(dest, ["remote", "set-url", "origin", remoteUrl]);
  }
}

/** Prepare a run workspace: local git dir, or git clone when a remote repo is configured. */
export function prepareWorkspace(repoUrl: string, dest: string, branch = "main"): void {
  if (!isRemoteRepo(repoUrl)) {
    initLocalGitWorkspace(dest, branch);
    return;
  }
  if (existsSync(dest)) return;
  cloneRepo(repoUrl, dest);
}

export const initGitRepo = tool(
  async ({ initial_commit_message }, config: RunnableConfig) => {
    const ctx = getRunContextFromConfig(config);
    initLocalGitWorkspace(ctx.workspaceDir, ctx.branch);
    if (initial_commit_message?.trim()) {
      git(ctx.workspaceDir, ["add", "-A"]);
      git(ctx.workspaceDir, ["commit", "-m", initial_commit_message.trim(), "--allow-empty"]);
    }
    const remote = gitRemoteUrl(ctx.workspaceDir);
    return (
      `Git repository ready in workspace (branch ${ctx.branch}).\n` +
      (remote
        ? `Remote origin: ${remote.replace(/x-access-token:[^@]+@/, "***@")}`
        : "No GitHub remote yet — call create_github_repo to create and link one.") +
      `\nRun context repo: ${ctx.repoUrl}`
    );
  },
  {
    name: "init_git_repo",
    description:
      "Initialize (or ensure) a local git repository in the workspace with agent git identity. " +
      "Use before first commit when starting a new coding project. " +
      "For GitHub hosting, follow with create_github_repo then git_commit and git_push.",
    schema: z.object({
      initial_commit_message: z.string().optional().describe("Optional empty initial commit message"),
    }),
  }
);

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
    const remoteUrl = gitRemoteUrl(ctx.workspaceDir);
    if (!remoteUrl) {
      return (
        "ERROR: No git remote 'origin'. Call create_github_repo to create a GitHub repository " +
        "and link it as origin, then retry git_push."
      );
    }
    const token = ctx.githubToken || env.GITHUB_TOKEN || "";
    let args: string[];
    if (token && remoteUrl.startsWith("https://")) {
      const authed = embedTokenInHttpsUrl(remoteUrl, token);
      args = ["push", "-u", authed, `HEAD:${b}`];
    } else {
      args = ["push", "-u", "origin", b];
    }
    const result = git(ctx.workspaceDir, args);
    return result.ok ? result.out.trim() || `Pushed ${b}` : `ERROR: ${result.out}`;
  },
  {
    name: "git_push",
    description:
      "Push branch to origin. Requires a linked GitHub remote (create_github_repo) and GITHUB_TOKEN.",
    schema: z.object({ branch: z.string().optional() }),
  }
);
