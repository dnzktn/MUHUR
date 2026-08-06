import { describe, it, expect, beforeAll } from "vitest";
import Fastify from "fastify";
import { requireAuth } from "../../src/lib/auth-guard";
import { signAuthToken } from "../../src/lib/jwt";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
});

function buildTestApp() {
  const app = Fastify();
  app.get("/protected", { preHandler: requireAuth }, async (request) => ({
    professional: (request as any).professional,
  }));
  return app;
}

describe("requireAuth", () => {
  it("rejects requests without a token", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/protected" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an invalid token", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("allows a valid token and attaches the professional payload", async () => {
    const app = buildTestApp();
    const token = signAuthToken({ professionalId: "abc-123", email: "yagmur@muhur.com" });
    const res = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().professional.professionalId).toBe("abc-123");
  });
});
