import { describe, it, expect, vi } from "vitest";
import { assertModelAllowed } from "../src/models-llm.js";

vi.mock("../src/config.js", () => ({
  env: {
    MODEL_PRIMARY: "openai:gpt-4.1",
    MODEL_FALLBACK: "openai:gpt-4.1",
    OPENAI_API_KEY: "test",
    GITHUB_COPILOT_TOKEN: "",
    EMBEDDING_MODEL: "openai:text-embedding-3-small",
  },
}));

describe("models-llm", () => {
  it("blocks anthropic models", () => {
    expect(() => assertModelAllowed("anthropic:claude-3")).toThrow();
    expect(() => assertModelAllowed("openai:gpt-4.1")).not.toThrow();
  });
});
