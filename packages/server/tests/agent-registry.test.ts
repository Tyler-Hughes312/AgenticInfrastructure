import { describe, expect, it } from "vitest";
import {
  defaultFlowFromEdges,
  normalizeOrchestratorConfig,
  syncRoutesToFromEdges,
} from "../src/agents/agent-registry.js";

describe("orchestrator graph edge flows", () => {
  it("syncs routesTo from edges so connections drive routing", () => {
    const agents = syncRoutesToFromEdges(
      [
        { id: "coder", label: "Coder", role: "code", tools: ["read_file"], routesTo: [] },
        { id: "reviewer", label: "Reviewer", role: "review", tools: ["read_file"], routesTo: [] },
      ],
      [
        { source: "supervisor", target: "coder" },
        { source: "coder", target: "reviewer" },
        { source: "reviewer", target: "coder", label: "if changes needed" },
      ]
    );

    expect(agents.find((a) => a.id === "coder")?.routesTo).toEqual(["reviewer"]);
    expect(agents.find((a) => a.id === "reviewer")?.routesTo).toEqual(["coder"]);
  });

  it("normalizeOrchestratorConfig applies edge sync", () => {
    const cfg = normalizeOrchestratorConfig({
      agents: [
        { id: "coder", label: "Coder", role: "code", tools: ["read_file"], routesTo: [] },
        { id: "docs", label: "Docs", role: "docs", tools: ["read_file"], routesTo: [] },
      ],
      edges: [
        { source: "supervisor", target: "coder" },
        { source: "coder", target: "docs" },
      ],
    });

    expect(cfg.agents.find((a) => a.id === "coder")?.routesTo).toEqual(["docs"]);
    expect(cfg.agents.find((a) => a.id === "docs")?.routesTo).toEqual([]);
  });

  it("derives default flow from supervisor edges", () => {
    expect(
      defaultFlowFromEdges([
        { source: "supervisor", target: "coder" },
        { source: "coder", target: "reviewer" },
        { source: "reviewer", target: "pr_opener" },
      ])
    ).toEqual(["coder", "reviewer", "pr_opener"]);
  });
});
