import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../../src/app";
import { prisma } from "../../src/prisma";
import { hashPassword } from "../../src/lib/password";
import { signAuthToken } from "../../src/lib/jwt";
import { resetDb } from "../helpers/reset-db";

async function seedOrderWithDraft() {
  const unique = crypto.randomUUID();
  const tenant = await prisma.tenant.create({ data: { name: "Mühür" } });
  const customer = await prisma.customer.create({
    data: { tenantId: tenant.id, name: "Demo Müşteri", email: `demo-${unique}@musteri.com` },
  });
  const professional = await prisma.verifiedProfessional.create({
    data: {
      tenantId: tenant.id,
      name: "Yağmur",
      email: `yagmur-${unique}@muhur.com`,
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

describe("GET /api/orders/:id", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

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

describe("PATCH /api/orders/:id/finalize", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a FinalTranslation and marks the order approved", async () => {
    const { order, professional } = await seedOrderWithDraft();
    const document = await prisma.document.findFirstOrThrow({ where: { orderId: order.id } });
    const token = signAuthToken({ professionalId: professional.id, email: professional.email });
    const app = buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: `/api/orders/${order.id}/finalize`,
      headers: { authorization: `Bearer ${token}` },
      payload: { documentId: document.id, finalText: "Hello world, final." },
    });

    expect(res.statusCode).toBe(201);

    const finalTranslation = await prisma.finalTranslation.findUnique({ where: { documentId: document.id } });
    expect(finalTranslation?.finalText).toBe("Hello world, final.");
    expect(finalTranslation?.editedById).toBe(professional.id);

    const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(updatedOrder?.status).toBe("APPROVED");
  });

  it("returns 400 when the document does not belong to the order", async () => {
    const { order: orderA, professional } = await seedOrderWithDraft();
    const { order: orderB } = await seedOrderWithDraft();
    const documentB = await prisma.document.findFirstOrThrow({ where: { orderId: orderB.id } });
    const token = signAuthToken({ professionalId: professional.id, email: professional.email });
    const app = buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: `/api/orders/${orderA.id}/finalize`,
      headers: { authorization: `Bearer ${token}` },
      payload: { documentId: documentB.id, finalText: "Mismatched." },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for an unknown order id", async () => {
    const { professional } = await seedOrderWithDraft();
    const token = signAuthToken({ professionalId: professional.id, email: professional.email });
    const app = buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: "/api/orders/00000000-0000-0000-0000-000000000000/finalize",
      headers: { authorization: `Bearer ${token}` },
      payload: { documentId: "00000000-0000-0000-0000-000000000000", finalText: "x" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 409 and does not create a second FinalTranslation when finalizing twice", async () => {
    const { order, professional } = await seedOrderWithDraft();
    const document = await prisma.document.findFirstOrThrow({ where: { orderId: order.id } });
    const token = signAuthToken({ professionalId: professional.id, email: professional.email });
    const app = buildApp();

    const firstRes = await app.inject({
      method: "PATCH",
      url: `/api/orders/${order.id}/finalize`,
      headers: { authorization: `Bearer ${token}` },
      payload: { documentId: document.id, finalText: "Hello world, final." },
    });
    expect(firstRes.statusCode).toBe(201);

    const secondRes = await app.inject({
      method: "PATCH",
      url: `/api/orders/${order.id}/finalize`,
      headers: { authorization: `Bearer ${token}` },
      payload: { documentId: document.id, finalText: "Hello world, final (again)." },
    });

    expect(secondRes.statusCode).toBe(409);
    expect(secondRes.json().error).toBeTruthy();

    const finalTranslations = await prisma.finalTranslation.findMany({ where: { documentId: document.id } });
    expect(finalTranslations).toHaveLength(1);
    expect(finalTranslations[0].finalText).toBe("Hello world, final.");
  });

  it("returns 400 when the request body is missing required fields", async () => {
    const { order, professional } = await seedOrderWithDraft();
    const document = await prisma.document.findFirstOrThrow({ where: { orderId: order.id } });
    const token = signAuthToken({ professionalId: professional.id, email: professional.email });
    const app = buildApp();

    const noBodyRes = await app.inject({
      method: "PATCH",
      url: `/api/orders/${order.id}/finalize`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(noBodyRes.statusCode).toBe(400);
    expect(noBodyRes.json().error).toBeTruthy();

    const missingFinalTextRes = await app.inject({
      method: "PATCH",
      url: `/api/orders/${order.id}/finalize`,
      headers: { authorization: `Bearer ${token}` },
      payload: { documentId: document.id },
    });
    expect(missingFinalTextRes.statusCode).toBe(400);
    expect(missingFinalTextRes.json().error).toBeTruthy();
  });
});
