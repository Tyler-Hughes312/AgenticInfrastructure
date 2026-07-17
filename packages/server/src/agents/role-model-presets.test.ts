import { describe, it, expect } from "vitest";
import { suggestModelForRole, shortModelLabel } from "./role-model-presets.js";

describe("suggestModelForRole", () => {
  it("assigns code model to implementers", () => {
    expect(
      suggestModelForRole({
        label: "Builder",
        role: "Implements features in the codebase",
        tools: ["write_file", "edit_file"],
      })
    ).toBe("copilot:gpt-4o");
  });

  it("assigns plan model to planners", () => {
    expect(
      suggestModelForRole({
        label: "Planner",
        role: "Plans architecture and product scope",
        tools: ["read_file", "manage_memory"],
      })
    ).toBe("copilot:gpt-4.1");
  });

  it("assigns review model to reviewers", () => {
    expect(
      suggestModelForRole({
        label: "Reviewer",
        role: "Reviews PRs and critiques quality",
        tools: ["read_file"],
      })
    ).toBe("copilot:gpt-4.1");
  });

  it("assigns light model to classifiers", () => {
    expect(
      suggestModelForRole({
        label: "Router",
        role: "Classifies and routes lightweight requests",
        tools: ["read_file"],
      })
    ).toBe("copilot:gpt-4o-mini");
  });
});

describe("shortModelLabel", () => {
  it("strips provider prefix", () => {
    expect(shortModelLabel("copilot:gpt-4o")).toBe("gpt-4o");
    expect(shortModelLabel(undefined)).toBe("default");
  });
});
