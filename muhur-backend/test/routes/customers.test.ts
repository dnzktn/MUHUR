import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../../src/app";
import { prisma } from "../../src/prisma";
import { resetDb } from "../helpers/reset-db";

describe("POST /api/customers", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.tenant.create({ data: { name: "Mühür" } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a new customer and returns its id", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/customers",
      payload: { name: "Ayşe Yılmaz", email: "ayse@example.com" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.customerId).toBeTypeOf("string");

    const customer = await prisma.customer.findUnique({ where: { id: body.customerId } });
    expect(customer?.name).toBe("Ayşe Yılmaz");
    expect(customer?.email).toBe("ayse@example.com");
  });

  it("upserts by email — a second call with the same email returns the same id and updates the name", async () => {
    const app = buildApp();
    const first = await app.inject({
      method: "POST",
      url: "/api/customers",
      payload: { name: "Ayşe Yılmaz", email: "ayse@example.com" },
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/customers",
      payload: { name: "Ayşe Y.", email: "ayse@example.com" },
    });

    expect(second.statusCode).toBe(201);
    expect(first.json().customerId).toBe(second.json().customerId);

    const customer = await prisma.customer.findUnique({ where: { id: first.json().customerId } });
    expect(customer?.name).toBe("Ayşe Y.");
  });

  it("returns 400 when email is missing", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/customers",
      payload: { name: "Ayşe Yılmaz" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeTruthy();
  });

  it("returns 400 when name is missing", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/customers",
      payload: { email: "ayse@example.com" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeTruthy();
  });
});
