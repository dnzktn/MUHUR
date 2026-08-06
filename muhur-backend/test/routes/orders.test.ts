import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../../src/app";
import { prisma } from "../../src/prisma";
import { hashPassword } from "../../src/lib/password";
import { signAuthToken } from "../../src/lib/jwt";
import { resetDb } from "../helpers/reset-db";

describe("GET /api/orders/:id", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedOrderWithDraft() {
    const tenant = await prisma.tenant.create({ data: { name: "Mühür" } });
    const customer = await prisma.customer.create({
      data: { tenantId: tenant.id, name: "Demo Müşteri", email: "demo@musteri.com" },
    });
    const professional = await prisma.verifiedProfessional.create({
      data: {
        tenantId: tenant.id,
        name: "Yağmur",
        email: "yagmur@muhur.com",
        passwordHash: await hashPassword("changeme123"),
        languages: ["TR", "EN"],
      },
    });
    const order = await prisma.order.create({
      data: { tenantId: tenant.id, customerId: customer.id, status: "DRAFTS_READY" },
    });
    const document = await prisma.document.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        orderId: order.id,
        sourceFormat: "PASTED_TEXT",
        extractedText: "Merhaba dünya",
        sourceLang: "TR",
        targetLang: "EN",
        status: "READY",
      },
    });
    await prisma.draft.create({
      data: { documentId: document.id, provider: "gemini", draftText: "Hello world", status: "READY" },
    });
    return { order, professional };
  }

  it("rejects requests without a token", async () => {
    const { order } = await seedOrderWithDraft();
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: `/api/orders/${order.id}` });
    expect(res.statusCode).toBe(401);
  });

  it("returns the order with documents and drafts for an authenticated request", async () => {
    const { order, professional } = await seedOrderWithDraft();
    const token = signAuthToken({ professionalId: professional.id, email: professional.email });
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: `/api/orders/${order.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(order.id);
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0].drafts[0].draftText).toBe("Hello world");
  });

  it("returns 404 for an unknown order id", async () => {
    const tenant = await prisma.tenant.create({ data: { name: "Mühür" } });
    const professional = await prisma.verifiedProfessional.create({
      data: {
        tenantId: tenant.id,
        name: "Yağmur",
        email: "yagmur@muhur.com",
        passwordHash: await hashPassword("changeme123"),
        languages: ["TR", "EN"],
      },
    });
    const token = signAuthToken({ professionalId: professional.id, email: professional.email });
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/orders/00000000-0000-0000-0000-000000000000",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });
});
