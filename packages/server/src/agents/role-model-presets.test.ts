import { describe, it, expect } from "vitest";
import {
  suggestModelForRole,
  shortModelLabel,
  BEDROCK_GPT_OSS_120B,
} from "./role-model-presets.js";

describe("suggestModelForRole", () => {
  it("assigns Bedrock GPT-OSS-120B to implementers", () => {
    expect(
      suggestModelForRole({
        label: "Builder",
        role: "Implements features in the codebase",
        tools: ["write_file", "edit_file"],
      })
    ).toBe(BEDROCK_GPT_OSS_120B);
  });

  it("assigns Bedrock GPT-OSS-120B to planners", () => {
    expect(
      suggestModelForRole({
        label: "Planner",
        role: "Plans architecture and product scope",
        tools: ["read_file", "manage_memory"],
      })
    ).toBe(BEDROCK_GPT_OSS_120B);
  });

  it("assigns Bedrock GPT-OSS-120B to reviewers", () => {
    expect(
      suggestModelForRole({
        label: "Reviewer",
        role: "Reviews PRs and critiques quality",
        tools: ["read_file"],
      })
    ).toBe(BEDROCK_GPT_OSS_120B);
  });

  it("assigns Bedrock GPT-OSS-120B to classifiers", () => {
    expect(
      suggestModelForRole({
        label: "Router",
        role: "Classifies and routes lightweight requests",
        tools: ["read_file"],
      })
    ).toBe(BEDROCK_GPT_OSS_120B);
  });
});

describe("shortModelLabel", () => {
  it("strips provider prefix including bedrock model ids with colons", () => {
    expect(shortModelLabel("copilot:gpt-4o")).toBe("gpt-4o");
    expect(shortModelLabel(BEDROCK_GPT_OSS_120B)).toBe("openai.gpt-oss-120b-1:0");
    expect(shortModelLabel(undefined)).toBe("default");
  });
});
