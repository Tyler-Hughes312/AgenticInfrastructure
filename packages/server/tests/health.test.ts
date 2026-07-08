import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import cors from "@fastify/cors";

vi.mock("../src/db.js", () => ({
  setupDb: vi.fn().mockResolvedValue(undefined),
  shutdownDb: vi.fn().mockResolvedValue(undefined),
  getPool: vi.fn(),
  getCheckpointer: vi.fn(),
  getStore: vi.fn(),
}));

vi.mock("../src/db/app-db.js", () => ({
  setupAppTables: vi.fn().mockResolvedValue(undefined),
  getAppDb: vi.fn(),
}));

describe("health", () => {
  it("returns ok", async () => {
    const app = Fastify();
    await app.register(cors);
    app.get("/health", async () => ({ status: "ok" }));
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });
});
