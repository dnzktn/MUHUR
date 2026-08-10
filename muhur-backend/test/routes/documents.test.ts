import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import FormData from "form-data";
import { Document as DocxDocument, Packer, Paragraph, TextRun } from "docx";
import { buildApp } from "../../src/app";
import { prisma } from "../../src/prisma";
import { resetDb } from "../helpers/reset-db";
import type { TranslationProvider } from "../../src/services/gemini.service";
import { signAuthToken } from "../../src/lib/jwt";
import { hashPassword } from "../../src/lib/password";

function fakeProvider(overrides: Partial<TranslationProvider> = {}): TranslationProvider {
  return {
    translate: vi.fn().mockResolvedValue("Translated output"),
    suggest: vi.fn().mockResolvedValue(["a", "b", "c"]),
    ...overrides,
  };
}

async function seedCustomer() {
  const tenant = await prisma.tenant.create({ data: { name: "Mühür" } });
  return prisma.customer.create({
    data: { tenantId: tenant.id, name: "Demo Müşteri", email: "demo@musteri.com" },
  });
}

describe("POST /api/documents", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates an order, document, and ready draft from pasted text", async () => {
    const customer = await seedCustomer();
    const geminiService = fakeProvider();
    const app = buildApp({ geminiService });

    const form = new FormData();
    form.append("customerId", customer.id);
    form.append("sourceLang", "TR");
    form.append("targetLang", "EN");
    form.append("pastedText", "Bu belge nüfus cüzdanı örneğidir.");

    const res = await app.inject({
      method: "POST",
      url: "/api/documents",
      headers: form.getHeaders(),
      payload: form.getBuffer(),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();

    const draft = await prisma.draft.findUnique({ where: { id: body.draftId } });
    expect(draft?.status).toBe("READY");
    expect(draft?.draftText).toBe("Translated output");

    const order = await prisma.order.findUnique({ where: { id: body.orderId } });
    expect(order?.status).toBe("DRAFTS_READY");
  });

  it("extracts text from an uploaded docx file before translating", async () => {
    const customer = await seedCustomer();
    const geminiService = fakeProvider();
    const app = buildApp({ geminiService });

    const docxDoc = new DocxDocument({
      sections: [{ children: [new Paragraph({ children: [new TextRun("Doğum belgesi")] })] }],
    });
    const docxBuffer = await Packer.toBuffer(docxDoc);

    const form = new FormData();
    form.append("customerId", customer.id);
    form.append("sourceLang", "TR");
    form.append("targetLang", "EN");
    form.append("file", docxBuffer, {
      filename: "belge.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/documents",
      headers: form.getHeaders(),
      payload: form.getBuffer(),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    const document = await prisma.document.findUnique({ where: { id: body.documentId } });
    expect(document?.sourceFormat).toBe("DOCX");
    expect(document?.extractedText).toBe("Doğum belgesi");
    expect(geminiService.translate).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Doğum belgesi" })
    );
  });

  it("returns 400 when neither file nor pastedText is provided", async () => {
    const customer = await seedCustomer();
    const app = buildApp({ geminiService: fakeProvider() });

    const form = new FormData();
    form.append("customerId", customer.id);
    form.append("sourceLang", "TR");
    form.append("targetLang", "EN");

    const res = await app.inject({
      method: "POST",
      url: "/api/documents",
      headers: form.getHeaders(),
      payload: form.getBuffer(),
    });

    expect(res.statusCode).toBe(400);
  });

  it("does not create an orphan order when the file type is unsupported", async () => {
    const customer = await seedCustomer();
    const app = buildApp({ geminiService: fakeProvider() });

    const orderCountBefore = await prisma.order.count();

    const form = new FormData();
    form.append("customerId", customer.id);
    form.append("sourceLang", "TR");
    form.append("targetLang", "EN");
    form.append("file", Buffer.from("not a real file"), {
      filename: "belge.txt",
      contentType: "text/plain",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/documents",
      headers: form.getHeaders(),
      payload: form.getBuffer(),
    });

    expect(res.statusCode).toBe(400);

    const orderCountAfter = await prisma.order.count();
    expect(orderCountAfter).toBe(orderCountBefore);
  });

  it("marks the draft failed and returns 502 when Gemini errors", async () => {
    const customer = await seedCustomer();
    const geminiService = fakeProvider({
      translate: vi.fn().mockRejectedValue(new Error("quota exceeded")),
    });
    const app = buildApp({ geminiService });

    const form = new FormData();
    form.append("customerId", customer.id);
    form.append("sourceLang", "TR");
    form.append("targetLang", "EN");
    form.append("pastedText", "Merhaba dünya");

    const res = await app.inject({
      method: "POST",
      url: "/api/documents",
      headers: form.getHeaders(),
      payload: form.getBuffer(),
    });

    expect(res.statusCode).toBe(502);

    const drafts = await prisma.draft.findMany();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].status).toBe("FAILED");

    const order = await prisma.order.findFirst({ where: { customerId: customer.id } });
    expect(order?.status).toBe("RECEIVED");
  });
});

describe("POST /api/documents/:id/suggest", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedDocumentAndProfessional() {
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
    return { document, professional };
  }

  it("rejects requests without a token", async () => {
    const { document } = await seedDocumentAndProfessional();
    const app = buildApp({ geminiService: fakeProvider() });
    const res = await app.inject({
      method: "POST",
      url: `/api/documents/${document.id}/suggest`,
      payload: { text: "Merhaba", context: "Merhaba dünya" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns suggestions for an authenticated request", async () => {
    const { document, professional } = await seedDocumentAndProfessional();
    const token = signAuthToken({
      professionalId: professional.id,
      email: professional.email,
      tenantId: professional.tenantId,
    });
    const geminiService = fakeProvider({
      suggest: vi.fn().mockResolvedValue(["Hello", "Hi", "Greetings"]),
    });
    const app = buildApp({ geminiService });

    const res = await app.inject({
      method: "POST",
      url: `/api/documents/${document.id}/suggest`,
      headers: { authorization: `Bearer ${token}` },
      payload: { text: "Merhaba", context: "Merhaba dünya" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().suggestions).toEqual(["Hello", "Hi", "Greetings"]);
  });

  it("returns 404 for an unknown document id", async () => {
    const { professional } = await seedDocumentAndProfessional();
    const token = signAuthToken({
      professionalId: professional.id,
      email: professional.email,
      tenantId: professional.tenantId,
    });
    const app = buildApp({ geminiService: fakeProvider() });

    const res = await app.inject({
      method: "POST",
      url: "/api/documents/00000000-0000-0000-0000-000000000000/suggest",
      headers: { authorization: `Bearer ${token}` },
      payload: { text: "Merhaba", context: "Merhaba dünya" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 404 when the document belongs to a different tenant", async () => {
    const { document: documentInTenantB } = await seedDocumentAndProfessional();
    const { professional: professionalInTenantA } = await seedDocumentAndProfessional();
    const token = signAuthToken({
      professionalId: professionalInTenantA.id,
      email: professionalInTenantA.email,
      tenantId: professionalInTenantA.tenantId,
    });
    const app = buildApp({ geminiService: fakeProvider() });

    const res = await app.inject({
      method: "POST",
      url: `/api/documents/${documentInTenantB.id}/suggest`,
      headers: { authorization: `Bearer ${token}` },
      payload: { text: "Merhaba", context: "Merhaba dünya" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 400 when the request body is missing required fields", async () => {
    const { document, professional } = await seedDocumentAndProfessional();
    const token = signAuthToken({
      professionalId: professional.id,
      email: professional.email,
      tenantId: professional.tenantId,
    });
    const app = buildApp({ geminiService: fakeProvider() });

    const noBodyRes = await app.inject({
      method: "POST",
      url: `/api/documents/${document.id}/suggest`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(noBodyRes.statusCode).toBe(400);
    expect(noBodyRes.json().error).toBeTruthy();

    const missingContextRes = await app.inject({
      method: "POST",
      url: `/api/documents/${document.id}/suggest`,
      headers: { authorization: `Bearer ${token}` },
      payload: { text: "Merhaba" },
    });
    expect(missingContextRes.statusCode).toBe(400);
    expect(missingContextRes.json().error).toBeTruthy();
  });
});
