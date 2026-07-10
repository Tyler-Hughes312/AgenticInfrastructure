import { describe, it, expect } from "vitest";
import { parseGraphEditCommand } from "../src/agents/graph-edit.js";
import { isLlmGraphEdit } from "../src/agents/design-graph-from-prompt.js";

describe("llm-driven graph edits", () => {
  it("parses parallel dev refinement as LLM refine command", () => {
    const cmd = parseGraphEditCommand("make there be parallel devs on that level");
    expect(cmd).toEqual({ type: "refine", task: "make there be parallel devs on that level" });
    expect(cmd && isLlmGraphEdit(cmd)).toBe(true);
  });

  it("parses add parallel developers as refine", () => {
    const cmd = parseGraphEditCommand("add parallel developers");
    expect(cmd?.type).toBe("refine");
  });

  it("keeps connect as deterministic structural edit", () => {
    const cmd = parseGraphEditCommand("connect researcher → writer");
    expect(cmd?.type).toBe("connect");
    expect(cmd && isLlmGraphEdit(cmd)).toBe(false);
  });
});
