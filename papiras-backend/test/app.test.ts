import { describe, it, expect } from "vitest";
import { buildApp } from "../src/app";

describe("GET /health", () => {
  it("returns ok status", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});
