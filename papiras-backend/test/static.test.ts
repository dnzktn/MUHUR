import { describe, it, expect } from "vitest";
import { buildApp } from "../src/app";

describe("static file serving", () => {
  it("serves public/styles.css", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/styles.css" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/css");
    expect(res.body).toContain(".page");
  });
});
