import { describe, it, expect } from "vitest";
import { classifyMessageIntent, looksLikePipelineTask } from "./message-classifier.js";
import type { CustomAgentConfig } from "./agent-registry.js";

const agents: CustomAgentConfig[] = [
  { id: "researcher", label: "Researcher", role: "research", tools: ["shell"], routesTo: [] },
];

describe("looksLikePipelineTask (heuristic)", () => {
  it("treats greetings as non-pipeline", () => {
    expect(looksLikePipelineTask("hello")).toBe(false);
  });

  it("treats execution requests as pipeline", () => {
    expect(looksLikePipelineTask("Research jazz and write a 200-word essay")).toBe(true);
  });
});

describe("classifyMessageIntent - regex fast-path (no LLM needed)", () => {
  it("returns graph_edit for 'add security agent'", async () => {
    const result = await classifyMessageIntent("add security agent", agents);
    expect(result.kind).toBe("graph_edit");
  });

  it("returns graph_edit for 'remove researcher'", async () => {
    const result = await classifyMessageIntent("remove researcher", agents);
    expect(result.kind).toBe("graph_edit");
  });

  it("returns graph_edit for 'connect researcher → writer'", async () => {
    const result = await classifyMessageIntent("connect researcher → writer", agents);
    expect(result.kind).toBe("graph_edit");
  });

  it("returns graph_edit for 'rename researcher to Scout'", async () => {
    const result = await classifyMessageIntent("rename researcher to Scout", agents);
    expect(result.kind).toBe("graph_edit");
  });
});

describe("classifyMessageIntent - heuristic fast-path (no LLM needed)", () => {
  it("returns q_and_a for greetings", async () => {
    const result = await classifyMessageIntent("hello", agents);
    expect(result.kind).toBe("q_and_a");
  });

  it("returns q_and_a for graph meta questions", async () => {
    const result = await classifyMessageIntent("What agents do I have?", agents);
    expect(result.kind).toBe("q_and_a");
  });

  it("returns graph_design for team setup requests", async () => {
    const result = await classifyMessageIntent(
      "now make a full software dev team subagents",
      agents
    );
    expect(result.kind).toBe("graph_design");
  });

  it("returns task_run when team and product are requested together", async () => {
    const result = await classifyMessageIntent(
      "Build a full software dev team and implement a todo app",
      agents
    );
    expect(result.kind).toBe("task_run");
  });
});
