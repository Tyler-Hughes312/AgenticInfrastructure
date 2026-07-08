import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { Octokit } from "@octokit/rest";
import type { RunnableConfig } from "@langchain/core/runnables";
import { env } from "../config.js";
import { getRunContextFromConfig } from "./context.js";

function parseGithubRepo(repoUrl: string): [string, string] {
  const url = new URL(repoUrl);
  let path = url.pathname.replace(/^\//, "").replace(/\.git$/, "");
  const [owner, repo] = path.split("/");
  if (!owner || !repo) throw new Error(`Cannot parse repo URL: ${repoUrl}`);
  return [owner, repo];
}

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
