import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { buildApp } from "../../src/app";
import { prisma } from "../../src/prisma";
import { hashPassword } from "../../src/lib/password";
import { signAuthToken } from "../../src/lib/jwt";
import { resetDb } from "../helpers/reset-db";
import type { EmailProvider } from "../../src/services/email.service";

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
    const token = signAuthToken({
      professionalId: professional.id,
      email: professional.email,
      tenantId: professional.tenantId,
    });
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
    const token = signAuthToken({
      professionalId: professional.id,
      email: professional.email,
      tenantId: professional.tenantId,
    });
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/orders/00000000-0000-0000-0000-000000000000",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 404 when the order belongs to a different tenant", async () => {
    const { order: orderInTenantB } = await seedOrderWithDraft();
    const { professional: professionalInTenantA } = await seedOrderWithDraft();
    const token = signAuthToken({
      professionalId: professionalInTenantA.id,
      email: professionalInTenantA.email,
      tenantId: professionalInTenantA.tenantId,
    });
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: `/api/orders/${orderInTenantB.id}`,
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
    const token = signAuthToken({
      professionalId: professional.id,
      email: professional.email,
      tenantId: professional.tenantId,
    });
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
    const token = signAuthToken({
      professionalId: professional.id,
      email: professional.email,
      tenantId: professional.tenantId,
    });
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
    const token = signAuthToken({
      professionalId: professional.id,
      email: professional.email,
      tenantId: professional.tenantId,
    });
    const app = buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: "/api/orders/00000000-0000-0000-0000-000000000000/finalize",
      headers: { authorization: `Bearer ${token}` },
      payload: { documentId: "00000000-0000-0000-0000-000000000000", finalText: "x" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 404 when finalizing an order that belongs to a different tenant", async () => {
    const { order: orderInTenantB } = await seedOrderWithDraft();
    const documentInTenantB = await prisma.document.findFirstOrThrow({
      where: { orderId: orderInTenantB.id },
    });
    const { professional: professionalInTenantA } = await seedOrderWithDraft();
    const token = signAuthToken({
      professionalId: professionalInTenantA.id,
      email: professionalInTenantA.email,
      tenantId: professionalInTenantA.tenantId,
    });
    const app = buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: `/api/orders/${orderInTenantB.id}/finalize`,
      headers: { authorization: `Bearer ${token}` },
      payload: { documentId: documentInTenantB.id, finalText: "Cross-tenant attempt." },
    });

    expect(res.statusCode).toBe(404);

    const finalTranslation = await prisma.finalTranslation.findUnique({
      where: { documentId: documentInTenantB.id },
    });
    expect(finalTranslation).toBeNull();
  });

  it("returns 409 and does not create a second FinalTranslation when finalizing twice", async () => {
    const { order, professional } = await seedOrderWithDraft();
    const document = await prisma.document.findFirstOrThrow({ where: { orderId: order.id } });
    const token = signAuthToken({
      professionalId: professional.id,
      email: professional.email,
      tenantId: professional.tenantId,
    });
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
    const token = signAuthToken({
      professionalId: professional.id,
      email: professional.email,
      tenantId: professional.tenantId,
    });
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

describe("GET /api/orders", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects requests without a token", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/api/orders" });
    expect(res.statusCode).toBe(401);
  });

  it("returns only orders belonging to the professional's tenant, newest first", async () => {
    const { order: orderInTenantA, professional } = await seedOrderWithDraft();
    const { order: orderInTenantB } = await seedOrderWithDraft();
    const token = signAuthToken({
      professionalId: professional.id,
      email: professional.email,
      tenantId: professional.tenantId,
    });
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/orders",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(orderInTenantA.id);
    expect(body[0].customer.name).toBe("Demo Müşteri");
    expect(body.some((order: { id: string }) => order.id === orderInTenantB.id)).toBe(false);
  });

  it("returns an empty array when the tenant has no orders", async () => {
    const tenant = await prisma.tenant.create({ data: { name: "Boş Tenant" } });
    const professional = await prisma.verifiedProfessional.create({
      data: {
        tenantId: tenant.id,
        name: "Yağmur",
        email: "yagmur-empty@muhur.com",
        passwordHash: await hashPassword("changeme123"),
        languages: ["TR", "EN"],
      },
    });
    const token = signAuthToken({
      professionalId: professional.id,
      email: professional.email,
      tenantId: professional.tenantId,
    });
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/orders",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe("POST /api/orders/:id/send-email", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function fakeEmailProvider(overrides: Partial<EmailProvider> = {}): EmailProvider {
    return {
      send: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  it("rejects requests without a token", async () => {
    const { order } = await seedOrderWithDraft();
    const app = buildApp({ emailService: fakeEmailProvider() });
    const res = await app.inject({
      method: "POST",
      url: `/api/orders/${order.id}/send-email`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("sends the final translation by email and marks the order SENT", async () => {
    const { order, professional } = await seedOrderWithDraft();
    const document = await prisma.document.findFirstOrThrow({ where: { orderId: order.id } });
    await prisma.finalTranslation.create({
      data: { documentId: document.id, editedById: professional.id, finalText: "Hello world, final." },
    });
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: order.customerId } });
    const token = signAuthToken({
      professionalId: professional.id,
      email: professional.email,
      tenantId: professional.tenantId,
    });
    const emailService = fakeEmailProvider();
    const app = buildApp({ emailService });

    const res = await app.inject({
      method: "POST",
      url: `/api/orders/${order.id}/send-email`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(emailService.send).toHaveBeenCalledWith({
      to: customer.email,
      subject: "Çeviri Belgeniz Hazır",
      text: "Hello world, final.",
    });

    const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(updatedOrder?.status).toBe("SENT");
  });

  it("returns 400 when the order has no final translation yet", async () => {
    const { order, professional } = await seedOrderWithDraft();
    const token = signAuthToken({
      professionalId: professional.id,
      email: professional.email,
      tenantId: professional.tenantId,
    });
    const app = buildApp({ emailService: fakeEmailProvider() });

    const res = await app.inject({
      method: "POST",
      url: `/api/orders/${order.id}/send-email`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeTruthy();
  });

  it("returns 404 when the order belongs to a different tenant", async () => {
    const { order: orderInTenantB } = await seedOrderWithDraft();
    const { professional: professionalInTenantA } = await seedOrderWithDraft();
    const token = signAuthToken({
      professionalId: professionalInTenantA.id,
      email: professionalInTenantA.email,
      tenantId: professionalInTenantA.tenantId,
    });
    const app = buildApp({ emailService: fakeEmailProvider() });

    const res = await app.inject({
      method: "POST",
      url: `/api/orders/${orderInTenantB.id}/send-email`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 502 and leaves the order status unchanged when the email provider fails", async () => {
    const { order, professional } = await seedOrderWithDraft();
    const document = await prisma.document.findFirstOrThrow({ where: { orderId: order.id } });
    await prisma.finalTranslation.create({
      data: { documentId: document.id, editedById: professional.id, finalText: "Hello world, final." },
    });
    const token = signAuthToken({
      professionalId: professional.id,
      email: professional.email,
      tenantId: professional.tenantId,
    });
    const emailService = fakeEmailProvider({
      send: vi.fn().mockRejectedValue(new Error("Resend API error")),
    });
    const app = buildApp({ emailService });

    const res = await app.inject({
      method: "POST",
      url: `/api/orders/${order.id}/send-email`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(502);

    const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(updatedOrder?.status).toBe(order.status);
  });

  it("allows sending twice — resending is not blocked", async () => {
    const { order, professional } = await seedOrderWithDraft();
    const document = await prisma.document.findFirstOrThrow({ where: { orderId: order.id } });
    await prisma.finalTranslation.create({
      data: { documentId: document.id, editedById: professional.id, finalText: "Hello world, final." },
    });
    const token = signAuthToken({
      professionalId: professional.id,
      email: professional.email,
      tenantId: professional.tenantId,
    });
    const emailService = fakeEmailProvider();
    const app = buildApp({ emailService });

    const firstRes = await app.inject({
      method: "POST",
      url: `/api/orders/${order.id}/send-email`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(firstRes.statusCode).toBe(200);

    const secondRes = await app.inject({
      method: "POST",
      url: `/api/orders/${order.id}/send-email`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(secondRes.statusCode).toBe(200);
    expect(emailService.send).toHaveBeenCalledTimes(2);
  });
});

describe("POST /api/orders/:id/send-quote", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function fakeEmailProvider(overrides: Partial<EmailProvider> = {}): EmailProvider {
    return {
      send: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  it("rejects requests without a token", async () => {
    const { order } = await seedOrderWithDraft();
    const app = buildApp({ emailService: fakeEmailProvider() });
    const res = await app.inject({
      method: "POST",
      url: `/api/orders/${order.id}/send-quote`,
      payload: { priceTotal: 360 },
    });
    expect(res.statusCode).toBe(401);
  });

  it("sends a quote email and updates priceTotal and status", async () => {
    const { order, professional } = await seedOrderWithDraft();
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: order.customerId } });
    const token = signAuthToken({
      professionalId: professional.id,
      email: professional.email,
      tenantId: professional.tenantId,
    });
    const emailService = fakeEmailProvider();
    const app = buildApp({ emailService });

    const res = await app.inject({
      method: "POST",
      url: `/api/orders/${order.id}/send-quote`,
      headers: { authorization: `Bearer ${token}` },
      payload: { priceTotal: 360 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "IN_REVIEW", priceTotal: 360 });
    expect(emailService.send).toHaveBeenCalledWith({
      to: customer.email,
      subject: "Çeviri Teklifiniz Hazır",
      text: expect.stringContaining("360"),
    });

    const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(updatedOrder?.priceTotal).toBe(360);
    expect(updatedOrder?.status).toBe("IN_REVIEW");
  });

  it("returns 400 when priceTotal is missing, zero, or negative", async () => {
    const { order, professional } = await seedOrderWithDraft();
    const token = signAuthToken({
      professionalId: professional.id,
      email: professional.email,
      tenantId: professional.tenantId,
    });
    const app = buildApp({ emailService: fakeEmailProvider() });

    const noBodyRes = await app.inject({
      method: "POST",
      url: `/api/orders/${order.id}/send-quote`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(noBodyRes.statusCode).toBe(400);

    const zeroRes = await app.inject({
      method: "POST",
      url: `/api/orders/${order.id}/send-quote`,
      headers: { authorization: `Bearer ${token}` },
      payload: { priceTotal: 0 },
    });
    expect(zeroRes.statusCode).toBe(400);

    const negativeRes = await app.inject({
      method: "POST",
      url: `/api/orders/${order.id}/send-quote`,
      headers: { authorization: `Bearer ${token}` },
      payload: { priceTotal: -50 },
    });
    expect(negativeRes.statusCode).toBe(400);
  });

  it("returns 404 when the order belongs to a different tenant", async () => {
    const { order: orderInTenantB } = await seedOrderWithDraft();
    const { professional: professionalInTenantA } = await seedOrderWithDraft();
    const token = signAuthToken({
      professionalId: professionalInTenantA.id,
      email: professionalInTenantA.email,
      tenantId: professionalInTenantA.tenantId,
    });
    const app = buildApp({ emailService: fakeEmailProvider() });

    const res = await app.inject({
      method: "POST",
      url: `/api/orders/${orderInTenantB.id}/send-quote`,
      headers: { authorization: `Bearer ${token}` },
      payload: { priceTotal: 200 },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 502 and leaves priceTotal/status unchanged when the email provider fails", async () => {
    const { order, professional } = await seedOrderWithDraft();
    const token = signAuthToken({
      professionalId: professional.id,
      email: professional.email,
      tenantId: professional.tenantId,
    });
    const emailService = fakeEmailProvider({
      send: vi.fn().mockRejectedValue(new Error("Resend API error")),
    });
    const app = buildApp({ emailService });

    const res = await app.inject({
      method: "POST",
      url: `/api/orders/${order.id}/send-quote`,
      headers: { authorization: `Bearer ${token}` },
      payload: { priceTotal: 360 },
    });

    expect(res.statusCode).toBe(502);

    const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(updatedOrder?.priceTotal).toBe(0);
    expect(updatedOrder?.status).toBe(order.status);
  });

  it("allows sending a quote twice — resending with an updated price is not blocked", async () => {
    const { order, professional } = await seedOrderWithDraft();
    const token = signAuthToken({
      professionalId: professional.id,
      email: professional.email,
      tenantId: professional.tenantId,
    });
    const emailService = fakeEmailProvider();
    const app = buildApp({ emailService });

    const firstRes = await app.inject({
      method: "POST",
      url: `/api/orders/${order.id}/send-quote`,
      headers: { authorization: `Bearer ${token}` },
      payload: { priceTotal: 360 },
    });
    expect(firstRes.statusCode).toBe(200);

    const secondRes = await app.inject({
      method: "POST",
      url: `/api/orders/${order.id}/send-quote`,
      headers: { authorization: `Bearer ${token}` },
      payload: { priceTotal: 420 },
    });
    expect(secondRes.statusCode).toBe(200);
    expect(emailService.send).toHaveBeenCalledTimes(2);

    const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(updatedOrder?.priceTotal).toBe(420);
  });
});
