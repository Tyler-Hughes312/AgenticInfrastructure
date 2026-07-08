import { describe, it, expect } from "vitest";
import {
  parseGraphEditCommand,
  applyGraphEdit,
} from "./graph-edit.js";
import type { OrchestratorGraphConfig } from "./agent-registry.js";

const baseConfig: OrchestratorGraphConfig = {
  agents: [
    { id: "researcher", label: "Researcher", role: "research", tools: ["shell"], routesTo: [] },
    { id: "writer", label: "Writer", role: "write", tools: ["shell"], routesTo: [] },
  ],
  edges: [{ source: "supervisor", target: "researcher", label: "start" }],
};

describe("parseGraphEditCommand - connect", () => {
  it("parses 'connect researcher → writer'", () => {
    expect(parseGraphEditCommand("connect researcher → writer")).toEqual({
      type: "connect",
      source: "researcher",
      target: "writer",
    });
  });
  it("parses 'wire researcher into writer'", () => {
    expect(parseGraphEditCommand("wire researcher into writer")).toEqual({
      type: "connect",
      source: "researcher",
      target: "writer",
    });
  });
  it("parses '/connect researcher writer'", () => {
    expect(parseGraphEditCommand("/connect researcher writer")).toEqual({
      type: "connect",
      source: "researcher",
      target: "writer",
    });
  });
});

describe("parseGraphEditCommand - disconnect", () => {
  it("parses 'disconnect supervisor from researcher'", () => {
    expect(parseGraphEditCommand("disconnect supervisor from researcher")).toEqual({
      type: "disconnect",
      source: "supervisor",
      target: "researcher",
    });
  });
  it("parses 'unlink researcher → writer'", () => {
    expect(parseGraphEditCommand("unlink researcher → writer")).toEqual({
      type: "disconnect",
      source: "researcher",
      target: "writer",
    });
  });
});

describe("parseGraphEditCommand - rename", () => {
  it("parses 'rename researcher to Scout'", () => {
    expect(parseGraphEditCommand("rename researcher to Scout")).toEqual({
      type: "rename",
      agentRef: "researcher",
      newLabel: "Scout",
    });
  });
  it("parses 'call writer Scribe'", () => {
    expect(parseGraphEditCommand("call writer Scribe")).toEqual({
      type: "rename",
      agentRef: "writer",
      newLabel: "Scribe",
    });
  });
});

describe("parseGraphEditCommand - rebuild", () => {
  it("parses 'rebuild graph for a 3-stage essay'", () => {
    expect(parseGraphEditCommand("rebuild graph for a 3-stage essay")).toEqual({
      type: "rebuild",
      task: "a 3-stage essay",
    });
  });
  it("parses '/rebuild write me a report'", () => {
    expect(parseGraphEditCommand("/rebuild write me a report")).toEqual({
      type: "rebuild",
      task: "write me a report",
    });
  });
});

describe("applyGraphEdit - connect", () => {
  it("adds an edge between two agents", () => {
    const { config, message } = applyGraphEdit(baseConfig, {
      type: "connect",
      source: "researcher",
      target: "writer",
    });
    expect(config.edges.some(e => e.source === "researcher" && e.target === "writer")).toBe(true);
    expect(message).toContain("researcher");
    expect(message).toContain("writer");
  });

  it("allows supervisor as source", () => {
    const { config } = applyGraphEdit(baseConfig, {
      type: "connect",
      source: "supervisor",
      target: "writer",
    });
    expect(config.edges.some(e => e.source === "supervisor" && e.target === "writer")).toBe(true);
  });

  it("returns error message for unknown agent", () => {
    const { config: unchanged, message } = applyGraphEdit(baseConfig, {
      type: "connect",
      source: "nobody",
      target: "writer",
    });
    expect(unchanged).toEqual(baseConfig);
    expect(message).toContain("Could not resolve");
  });
});

describe("applyGraphEdit - disconnect", () => {
  it("removes a matching edge", () => {
    const { config } = applyGraphEdit(baseConfig, {
      type: "disconnect",
      source: "supervisor",
      target: "researcher",
    });
    expect(config.edges.some(e => e.source === "supervisor" && e.target === "researcher")).toBe(false);
  });
});

describe("applyGraphEdit - rename", () => {
  it("updates the agent label", () => {
    const { config, message } = applyGraphEdit(baseConfig, {
      type: "rename",
      agentRef: "researcher",
      newLabel: "Scout",
    });
    const agent = config.agents.find(a => a.id === "researcher");
    expect(agent?.label).toBe("Scout");
    expect(message).toContain("Scout");
  });
});
