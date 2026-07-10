import { describe, it, expect } from "vitest";
import {
  looksLikeDirectChat,
  looksLikeGraphDesignRequest,
  looksLikeGraphMetaQuestion,
  looksLikePipelineTask,
  looksLikeProductDeliverable,
  isTeamStructureOnly,
  shouldExecutePipeline,
  taskNeedsGithubToken,
} from "./pipeline-gate.js";
import type { OrchestratorGraphConfig } from "./agent-registry.js";

const blankGraph: OrchestratorGraphConfig = { agents: [], edges: [] };
const withAgents: OrchestratorGraphConfig = {
  agents: [
    { id: "researcher", label: "Researcher", role: "research", tools: [], routesTo: [] },
  ],
  edges: [],
};

describe("looksLikePipelineTask", () => {
  it("returns false for greetings", () => {
    expect(looksLikePipelineTask("hello")).toBe(false);
    expect(looksLikePipelineTask("Thanks!")).toBe(false);
  });

  it("returns false for pure questions", () => {
    expect(looksLikePipelineTask("What agents do I have?")).toBe(false);
    expect(looksLikePipelineTask("How does this work?")).toBe(false);
  });

  it("returns true for execution requests", () => {
    expect(looksLikePipelineTask("Research jazz and write a 200-word essay")).toBe(true);
    expect(looksLikePipelineTask("Build a todo app and push to GitHub")).toBe(true);
  });
});

describe("looksLikeGraphMetaQuestion", () => {
  it("detects graph meta questions", () => {
    expect(looksLikeGraphMetaQuestion("What agents are in the graph?")).toBe(true);
    expect(looksLikeGraphMetaQuestion("Explain the pipeline")).toBe(true);
  });
});

describe("shouldExecutePipeline", () => {
  it("never runs pipeline for q_and_a intent", () => {
    expect(
      shouldExecutePipeline({
        task: "Research jazz and write essay",
        graphConfig: withAgents,
        intentKind: "q_and_a",
      })
    ).toBe(false);
  });

  it("runs pipeline when target agent is set", () => {
    expect(
      shouldExecutePipeline({
        task: "hello",
        graphConfig: withAgents,
        targetAgent: "researcher",
        intentKind: "task_run",
      })
    ).toBe(true);
  });

  it("skips pipeline for direct chat even when intent is task_run", () => {
    expect(
      shouldExecutePipeline({
        task: "hello",
        graphConfig: withAgents,
        intentKind: "task_run",
      })
    ).toBe(false);
  });

  it("runs pipeline for clear execution tasks with agents", () => {
    expect(
      shouldExecutePipeline({
        task: "Research jazz and write a 200-word essay",
        graphConfig: withAgents,
        intentKind: "task_run",
      })
    ).toBe(true);
  });

  it("skips pipeline on blank canvas for casual messages", () => {
    expect(
      shouldExecutePipeline({
        task: "What can you do?",
        graphConfig: blankGraph,
        intentKind: "task_run",
      })
    ).toBe(false);
  });
});

describe("looksLikeGraphDesignRequest", () => {
  it("detects team infrastructure requests", () => {
    expect(
      looksLikeGraphDesignRequest(
        "Build me a discovery team into a software dev team infrastructure"
      )
    ).toBe(true);
    expect(looksLikeGraphDesignRequest("now make a full software dev team subagents", 1)).toBe(
      true
    );
  });

  it("does not treat product build requests as graph design", () => {
    expect(looksLikeGraphDesignRequest("Build a todo app and push to GitHub")).toBe(false);
    expect(
      looksLikeGraphDesignRequest(
        "Build a full software dev team and implement a todo app"
      )
    ).toBe(false);
  });
});

describe("looksLikeProductDeliverable", () => {
  it("detects concrete product work", () => {
    expect(looksLikeProductDeliverable("Build a todo app and push to GitHub")).toBe(true);
    expect(looksLikeProductDeliverable("now make a full software dev team subagents")).toBe(false);
  });
});

describe("isTeamStructureOnly", () => {
  it("separates team setup from product delivery", () => {
    expect(isTeamStructureOnly("now make a full software dev team subagents", 1)).toBe(true);
    expect(isTeamStructureOnly("Build a todo app with a dev team")).toBe(false);
  });
});

describe("looksLikeDirectChat", () => {
  it("is inverse of pipeline task for common cases", () => {
    expect(looksLikeDirectChat("hello")).toBe(true);
    expect(looksLikeDirectChat("Research and write a report")).toBe(false);
  });
});

describe("taskNeedsGithubToken", () => {
  it("detects repo creation and push tasks on local workspaces", () => {
    expect(taskNeedsGithubToken("Create a GitHub repository for this project")).toBe(true);
    expect(taskNeedsGithubToken("Build an app and push to GitHub")).toBe(true);
    expect(taskNeedsGithubToken("hello")).toBe(false);
  });
});
