import { describe, it, expect } from "vitest";
import {
  enrichAgentWithSkills,
  inferToolsFromSkills,
  matchSkillId,
  mergeAgentTools,
  normalizeSkillIds,
  toolsFromSkillIds,
} from "./skill-catalog.js";

describe("inferToolsFromSkills", () => {
  it("always includes pipeline handoff tools", () => {
    const tools = inferToolsFromSkills(["technical_writing"], "Writer", "notes", "essay");
    expect(tools).toContain("publish_handoff");
    expect(tools).toContain("read_pipeline_context");
  });

  it("uses catalog tools when skill ids are provided", () => {
    const tools = inferToolsFromSkills(["debugging", "testing"], "Builder", "plan", "code");
    expect(tools).toContain("edit_file");
    expect(tools).toContain("shell");
  });

  it("adds git tools for github_publish skill", () => {
    const tools = toolsFromSkillIds(["github_publish"]);
    expect(tools).toContain("git_push");
    expect(tools).toContain("open_pull_request");
    expect(tools).toContain("create_github_repo");
  });
});

describe("matchSkillId", () => {
  it("maps freeform labels to catalog ids", () => {
    expect(matchSkillId("web research")).toBe("web_research");
    expect(matchSkillId("Testing")).toBe("testing");
  });
});

describe("normalizeSkillIds", () => {
  it("dedupes and normalizes mixed input", () => {
    expect(normalizeSkillIds(["web research", "web_research", "debugging"])).toEqual([
      "web_research",
      "debugging",
    ]);
  });
});

describe("mergeAgentTools", () => {
  it("dedupes designed and inferred tools", () => {
    const merged = mergeAgentTools(
      ["read_file", "publish_handoff"],
      ["read_file", "edit_file", "publish_handoff"]
    );
    expect(merged.filter((t) => t === "read_file")).toHaveLength(1);
    expect(merged).toContain("edit_file");
  });
});

describe("enrichAgentWithSkills", () => {
  it("merges tools and adds skill instructions to prompt", () => {
    const agent = enrichAgentWithSkills({
      id: "builder",
      label: "Builder",
      role: "Implements features",
      skills: ["implementation", "testing"],
      tools: ["read_file"],
      routesTo: [],
    });
    expect(agent.tools).toContain("shell");
    expect(agent.tools).toContain("edit_file");
    expect(agent.prompt).toContain("## Loaded skills");
    expect(agent.prompt).toContain("Testing");
  });
});
