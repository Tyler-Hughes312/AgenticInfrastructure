import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { setRunContext, clearRunContext } from "../src/tools/context.js";
import { readFile, editFile } from "../src/tools/file-editor.js";
import { shellTool } from "../src/tools/shell.js";
import { gitDiff, gitCommit, embedTokenInHttpsUrl } from "../src/tools/git-ops.js";

const runId = "test-run";
let workspace: string;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "agentic-test-"));
  execSync("git init", { cwd: workspace });
  execSync('git config user.email "test@test.com"', { cwd: workspace });
  execSync('git config user.name "Test"', { cwd: workspace });
  writeFileSync(join(workspace, "README.md"), "# Test\n");
  execSync("git add README.md && git commit -m init", { cwd: workspace, shell: true });
  setRunContext(runId, {
    workspaceDir: workspace,
    runId,
    projectId: "proj-1",
    repoUrl: "https://github.com/test/repo",
    githubToken: "",
    branch: "main",
  });
});

afterAll(() => {
  clearRunContext(runId);
  if (existsSync(workspace)) rmSync(workspace, { recursive: true, force: true });
});

const config = { configurable: { run_id: runId } };

describe("file tools", () => {
  it("reads and edits files", async () => {
    const content = await readFile.invoke({ path: "README.md" }, config);
    expect(content).toContain("# Test");
    await editFile.invoke(
      { path: "README.md", old_string: "# Test", new_string: "# Updated" },
      config
    );
    const updated = await readFile.invoke({ path: "README.md" }, config);
    expect(updated).toContain("# Updated");
  });
});

describe("shell tool", () => {
  it("runs commands in workspace", async () => {
    const out = await shellTool.invoke({ command: "pwd" }, config);
    expect(out).toContain(workspace.split("/").pop()!);
  });
});

describe("git tools", () => {
  it("embeds github token in https remote url", () => {
    expect(embedTokenInHttpsUrl("https://github.com/o/r.git", "secret")).toBe(
      "https://x-access-token:secret@github.com/o/r.git"
    );
  });

  it("shows diff and commits", async () => {
    writeFileSync(join(workspace, "foo.txt"), "hello");
    const diff = await gitDiff.invoke({}, config);
    expect(diff).toContain("foo.txt");
    const result = await gitCommit.invoke({ message: "add foo" }, config);
    expect(result).not.toContain("ERROR");
  });
});
