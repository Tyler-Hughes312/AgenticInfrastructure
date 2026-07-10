export const CODING_AGENT_NODES = ["supervisor", "coder", "reviewer", "pr_opener"] as const;

export type CodingAgentNode = (typeof CODING_AGENT_NODES)[number];

export const AGENT_STATUS_MESSAGES: Record<
  string,
  { start: string; end: string }
> = {
  supervisor: {
    start: "🧭 Supervisor routing to the right sub-agent...",
    end: "✓ Routing decision made.",
  },
  coder: {
    start: "💻 Coder implementing changes and running tests...",
    end: "✓ Implementation complete. Sending to reviewer...",
  },
  reviewer: {
    start: "🔍 Reviewer inspecting the diff...",
    end: "✓ Review complete.",
  },
  pr_opener: {
    start: "🚀 Opening pull request on GitHub...",
    end: "✓ Pull request opened.",
  },
};

export const TOOL_STATUS_MESSAGES: Record<string, string> = {
  shell: "⚙️ Running shell command...",
  read_file: "📄 Reading file...",
  edit_file: "✏️ Editing file...",
  git_diff: "📊 Checking git diff...",
  git_commit: "📦 Committing changes...",
  git_push: "⬆️ Pushing to GitHub...",
  git_create_branch: "🌿 Creating git branch...",
  create_github_repo: "🐙 Creating GitHub repository...",
  init_git_repo: "📁 Initializing git repository...",
  open_pull_request: "🔗 Opening pull request...",
  write_file: "📝 Writing file...",
  manage_memory: "🧠 Saving to memory...",
  search_memory: "🔎 Searching memory...",
};
