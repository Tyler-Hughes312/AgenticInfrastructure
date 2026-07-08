import { describe, it, expect, vi } from "vitest";
import { classifyMessageIntent } from "./message-classifier.js";
import type { CustomAgentConfig } from "./agent-registry.js";

const agents: CustomAgentConfig[] = [
  { id: "researcher", label: "Researcher", role: "research", tools: ["shell"], routesTo: [] },
];

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
