import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  getSessionWorkspaceDir,
  listWorkspaceTreeAtRoot,
  readWorkspaceFileExAtRoot,
} from "../src/services/workspace-service.js";
import { env } from "../src/config.js";
import { resolveInWorkspace } from "../src/tools/context.js";

const testSessionId = "00000000-0000-4000-8000-000000000001";

describe("workspace-service", () => {
  let root: string;

  beforeEach(() => {
    if (!existsSync(env.WORKSPACE_ROOT)) mkdirSync(env.WORKSPACE_ROOT, { recursive: true });
    root = getSessionWorkspaceDir(testSessionId);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "hello.txt"), "hello", "utf-8");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "app.ts"), "export {}", "utf-8");
  });

  afterEach(() => {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  });

  it("lists workspace tree", () => {
    const tree = listWorkspaceTreeAtRoot(root);
    expect(tree.some((n) => n.type === "file" && n.name === "hello.txt")).toBe(true);
    const srcDir = tree.find((n) => n.type === "dir" && n.name === "src");
    expect(srcDir?.type).toBe("dir");
    if (srcDir?.type === "dir") {
      expect(srcDir.children.some((c) => c.name === "app.ts")).toBe(true);
    }
  });

  it("reads files safely", () => {
    const file = readWorkspaceFileExAtRoot(root, "hello.txt");
    expect(file.kind).toBe("text");
    if (file.kind === "text") expect(file.content).toBe("hello");
  });

  it("rejects path traversal", () => {
    expect(() => resolveInWorkspace(root, "../../../etc/passwd")).toThrow();
  });
});
