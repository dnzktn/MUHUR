import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../../src/app";
import { prisma } from "../../src/prisma";
import { hashPassword } from "../../src/lib/password";
import { resetDb } from "../helpers/reset-db";

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedProfessional() {
    const tenant = await prisma.tenant.create({ data: { name: "Papiras" } });
    return prisma.verifiedProfessional.create({
      data: {
        tenantId: tenant.id,
        name: "Yağmur",
        email: "yagmur@papiras.com",
        passwordHash: await hashPassword("changeme123"),
        languages: ["TR", "EN", "FR"],
      },
    });
  }

  it("returns a token for correct credentials", async () => {
    await seedProfessional();
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "yagmur@papiras.com", password: "changeme123" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeTypeOf("string");
  });

  it("rejects an unknown email", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "nobody@papiras.com", password: "whatever" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects the wrong password", async () => {
    await seedProfessional();
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "yagmur@papiras.com", password: "wrong-password" },
    });
    expect(res.statusCode).toBe(401);
  });
});
