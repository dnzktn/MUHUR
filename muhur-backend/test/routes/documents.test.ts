import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import FormData from "form-data";
import { Document as DocxDocument, Packer, Paragraph, TextRun } from "docx";
import { buildApp } from "../../src/app";
import { prisma } from "../../src/prisma";
import { resetDb } from "../helpers/reset-db";
import type { TranslationProvider } from "../../src/services/gemini.service";

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
