import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { getModel } from "../models-llm.js";
import { shellTool } from "../tools/shell.js";
import { readFile, editFile } from "../tools/file-editor.js";
import { gitDiff, gitCommit } from "../tools/git-ops.js";
import { openPullRequest } from "../tools/github-pr.js";
import { manageMemory, searchMemory } from "../memory/tools.js";

const model = getModel();

export const coderWorker = createReactAgent({
  llm: model,
  tools: [shellTool, readFile, editFile, gitDiff, gitCommit, manageMemory, searchMemory],
  name: "coder",
  prompt:
    "You are a coding specialist. Make the requested code changes in the checked-out repo, " +
    "run relevant tests via the shell tool, and stop once the change is complete and tests pass. " +
    "Use manage_memory to record durable facts about this repo and search_memory to recall them. " +
    "Do not open a PR yourself — return control to the supervisor when done.",
});

export const reviewerWorker = createReactAgent({
  llm: model,
  tools: [gitDiff, readFile],
  name: "reviewer",
  prompt:
    "You are a code review specialist. Inspect the diff for correctness, style, and risk. " +
    "Approve or request changes with specific, actionable feedback. You do not edit code yourself.",
});

export const prWorker = createReactAgent({
  llm: model,
  tools: [openPullRequest],
  name: "pr_opener",
  prompt:
    "Open a pull request for the reviewed, approved changes. " +
    "Write a clear PR body summarizing what changed and why.",
});
