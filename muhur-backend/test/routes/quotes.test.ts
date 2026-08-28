import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { buildApp } from "../../src/app";
import { prisma } from "../../src/prisma";
import { resetDb } from "../helpers/reset-db";
import { signQuoteToken } from "../../src/lib/quote-token";
import type { EmailProvider } from "../../src/services/email.service";
import type { WhatsAppProvider } from "../../src/services/whatsapp.service";

const SECRET = "test-quote-secret";

async function seedOrderInReview() {
  const tenant = await prisma.tenant.create({ data: { name: "Mühür" } });
  const customer = await prisma.customer.create({
    data: { tenantId: tenant.id, name: "Demo Müşteri", email: "demo@musteri.com" },
  });
  const order = await prisma.order.create({
    data: { tenantId: tenant.id, customerId: customer.id, status: "IN_REVIEW", priceTotal: 360 },
  });
  return order;
}

function fakeProviders() {
  const emailService: EmailProvider = { send: vi.fn().mockResolvedValue(undefined) };
  const whatsappService: WhatsAppProvider = { send: vi.fn().mockResolvedValue(undefined) };
  return { emailService, whatsappService };
}

describe("GET /api/quotes/:orderId/accept", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("approves the order and redirects to the accepted page with a valid token", async () => {
    const order = await seedOrderInReview();
    const { emailService, whatsappService } = fakeProviders();
    const app = buildApp({
      emailService,
      whatsappService,
      notifyEmail: "yagmur@muhur.com",
      notifyWhatsappNumber: "+905551234567",
      quoteTokenSecret: SECRET,
      publicBaseUrl: "http://localhost:3000",
    });
    const token = signQuoteToken(order.id, "accept", SECRET);

    const res = await app.inject({
      method: "GET",
      url: `/api/quotes/${order.id}/accept?token=${token}`,
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/quote-accepted.html");

    const updated = await prisma.order.findUnique({ where: { id: order.id } });
    expect(updated?.status).toBe("APPROVED");

    expect(emailService.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "yagmur@muhur.com", subject: "Teklif Kabul Edildi" })
    );
    expect(whatsappService.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "+905551234567" })
    );
  });

  it("redirects to the invalid page with a wrong token, without changing status", async () => {
    const order = await seedOrderInReview();
    const { emailService, whatsappService } = fakeProviders();
    const app = buildApp({
      emailService,
      whatsappService,
      notifyEmail: "yagmur@muhur.com",
      notifyWhatsappNumber: "+905551234567",
      quoteTokenSecret: SECRET,
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/quotes/${order.id}/accept?token=wrong-token`,
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/quote-invalid.html");

    const updated = await prisma.order.findUnique({ where: { id: order.id } });
    expect(updated?.status).toBe("IN_REVIEW");
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it("redirects to the invalid page when the order is no longer IN_REVIEW", async () => {
    const order = await seedOrderInReview();
    await prisma.order.update({ where: { id: order.id }, data: { status: "APPROVED" } });
    const { emailService, whatsappService } = fakeProviders();
    const app = buildApp({
      emailService,
      whatsappService,
      notifyEmail: "yagmur@muhur.com",
      notifyWhatsappNumber: "+905551234567",
      quoteTokenSecret: SECRET,
    });
    const token = signQuoteToken(order.id, "accept", SECRET);

    const res = await app.inject({
      method: "GET",
      url: `/api/quotes/${order.id}/accept?token=${token}`,
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/quote-invalid.html");
  });
});

describe("GET /api/quotes/:orderId/reject", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("does not change status, notifies the professional, and redirects to the rejected page", async () => {
    const order = await seedOrderInReview();
    const { emailService, whatsappService } = fakeProviders();
    const app = buildApp({
      emailService,
      whatsappService,
      notifyEmail: "yagmur@muhur.com",
      notifyWhatsappNumber: "+905551234567",
      quoteTokenSecret: SECRET,
    });
    const token = signQuoteToken(order.id, "reject", SECRET);

    const res = await app.inject({
      method: "GET",
      url: `/api/quotes/${order.id}/reject?token=${token}`,
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/quote-rejected.html");

    const updated = await prisma.order.findUnique({ where: { id: order.id } });
    expect(updated?.status).toBe("IN_REVIEW");

    expect(emailService.send).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Teklif Reddedildi" })
    );
  });
});
