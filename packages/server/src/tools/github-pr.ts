import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { Octokit } from "@octokit/rest";
import { eq } from "drizzle-orm";
import type { RunnableConfig } from "@langchain/core/runnables";
import { env } from "../config.js";
import { getAppDb } from "../db/app-db.js";
import { projects } from "../db/schema.js";
import { getRunContextFromConfig, patchRunContext } from "./context.js";
import { initLocalGitWorkspace, linkRemoteOrigin } from "./git-ops.js";

function parseGithubRepo(repoUrl: string): [string, string] {
  const url = new URL(repoUrl);
  let path = url.pathname.replace(/^\//, "").replace(/\.git$/, "");
  const [owner, repo] = path.split("/");
  if (!owner || !repo) throw new Error(`Cannot parse repo URL: ${repoUrl}`);
  return [owner, repo];
}

async function persistProjectRepo(projectId: string, repoUrl: string): Promise<void> {
  const db = getAppDb();
  await db.update(projects).set({ repoUrl }).where(eq(projects.id, projectId));
}

export const createGithubRepo = tool(
  async ({ name, description, private: isPrivate, org }, config: RunnableConfig) => {
    const ctx = getRunContextFromConfig(config);
    const token = ctx.githubToken || env.GITHUB_TOKEN;
    if (!token) return "ERROR: GitHub token required. Set GITHUB_TOKEN in Settings or server .env";

    const octokit = new Octokit({ auth: token });
    const repoName = name.trim().replace(/\s+/g, "-").toLowerCase();
    if (!repoName) return "ERROR: repo name is required";

    let owner: string;
    let htmlUrl: string;
    let cloneUrl: string;

    try {
      if (org?.trim()) {
        const { data } = await octokit.repos.createInOrg({
          org: org.trim(),
          name: repoName,
          description: description?.trim() || undefined,
          private: isPrivate ?? false,
          auto_init: false,
        });
        owner = data.owner.login;
        htmlUrl = data.html_url;
        cloneUrl = data.clone_url;
      } else {
        const { data } = await octokit.repos.createForAuthenticatedUser({
          name: repoName,
          description: description?.trim() || undefined,
          private: isPrivate ?? false,
          auto_init: false,
        });
        owner = data.owner.login;
        htmlUrl = data.html_url;
        cloneUrl = data.clone_url;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `ERROR creating GitHub repo: ${msg}`;
    }

    initLocalGitWorkspace(ctx.workspaceDir, ctx.branch);
    linkRemoteOrigin(ctx.workspaceDir, cloneUrl);
    patchRunContext(ctx.runId, { repoUrl: htmlUrl });
    await persistProjectRepo(ctx.projectId, htmlUrl);

    return (
      `Created GitHub repository ${owner}/${repoName}\n` +
      `URL: ${htmlUrl}\n` +
      `Clone URL configured as origin.\n` +
      `Next: write code, git_commit, then git_push (token auth is automatic). ` +
      `Use open_pull_request when ready to ship.`
    );
  },
  {
    name: "create_github_repo",
    description:
      "Create a new GitHub repository under the authenticated user or an org, " +
      "wire it as origin for this workspace, and persist the repo URL for the project. " +
      "Use when starting a coding project with no remote yet, or when the user asks for a new GitHub repo.",
    schema: z.object({
      name: z.string().min(1).describe("Repository name (e.g. my-app)"),
      description: z.string().optional(),
      private: z.boolean().optional().default(false),
      org: z.string().optional().describe("GitHub org to create under; omit for personal account"),
    }),
  }
);

export const openPullRequest = tool(
  async ({ title, body, branch }, config: RunnableConfig) => {
    const ctx = getRunContextFromConfig(config);
    const token = ctx.githubToken || env.GITHUB_TOKEN;
    if (!token) return "ERROR: GITHUB_TOKEN not configured";
    const b = branch || ctx.branch;
    const [owner, repo] = parseGithubRepo(ctx.repoUrl);
    const octokit = new Octokit({ auth: token });
    const { data: repoData } = await octokit.repos.get({ owner, repo });
    const { data: pr } = await octokit.pulls.create({
      owner,
      repo,
      title,
      body,
      head: b,
      base: repoData.default_branch,
    });
    return pr.html_url;
  },
  {
    name: "open_pull_request",
    description: "Open a GitHub pull request for the current branch.",
    schema: z.object({
      title: z.string(),
      body: z.string(),
      branch: z.string().optional(),
    }),
  }
);
