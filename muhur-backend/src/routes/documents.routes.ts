import { FastifyInstance } from "fastify";
import { prisma } from "../prisma";
import { extractDocxText } from "../services/extraction.service";
import type { TranslationProvider } from "../services/gemini.service";
import { requireAuth } from "../lib/auth-guard";

interface DocumentsRoutesOptions {
  geminiService: TranslationProvider;
}

const MIME_TO_FORMAT: Record<string, "PDF" | "IMAGE" | "DOCX"> = {
  "application/pdf": "PDF",
  "image/png": "IMAGE",
  "image/jpeg": "IMAGE",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
};

export async function documentsRoutes(app: FastifyInstance, opts: DocumentsRoutesOptions): Promise<void> {
  app.post("/api/documents", async (request, reply) => {
    const parts = request.parts();

    let customerId: string | undefined;
    let sourceLang: string | undefined;
    let targetLang: string | undefined;
    let pastedText: string | undefined;
    let fileBuffer: Buffer | undefined;
    let mimeType: string | undefined;

    for await (const part of parts) {
      if (part.type === "file") {
        fileBuffer = await part.toBuffer();
        mimeType = part.mimetype;
      } else if (part.fieldname === "customerId") {
        customerId = part.value as string;
      } else if (part.fieldname === "sourceLang") {
        sourceLang = part.value as string;
      } else if (part.fieldname === "targetLang") {
        targetLang = part.value as string;
      } else if (part.fieldname === "pastedText") {
        pastedText = part.value as string;
      }
    }

    if (!customerId || !sourceLang || !targetLang) {
      return reply.code(400).send({ error: "customerId, sourceLang, targetLang are required" });
    }
    if (!fileBuffer && !pastedText) {
      return reply.code(400).send({ error: "Either a file or pastedText must be provided" });
    }

    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) {
      return reply.code(400).send({ error: "Unknown customerId" });
    }

    let sourceFormat: "PDF" | "IMAGE" | "DOCX" | "PASTED_TEXT";
    let extractedText: string | null = null;

    if (pastedText) {
      sourceFormat = "PASTED_TEXT";
      extractedText = pastedText;
    } else {
      const format = mimeType ? MIME_TO_FORMAT[mimeType] : undefined;
      if (!format) {
        return reply.code(400).send({ error: `Unsupported file type: ${mimeType ?? "unknown"}` });
      }
      sourceFormat = format;
      if (format === "DOCX") {
        extractedText = await extractDocxText(fileBuffer!);
      }
    }

    const order = await prisma.order.create({
      data: { tenantId: customer.tenantId, customerId: customer.id, status: "RECEIVED" },
    });

    const document = await prisma.document.create({
      data: {
        tenantId: customer.tenantId,
        customerId: customer.id,
        orderId: order.id,
        sourceFormat,
        extractedText,
        sourceLang,
        targetLang,
        status: "READY",
      },
    });

    await prisma.order.update({ where: { id: order.id }, data: { status: "AI_DRAFTING" } });

    const draft = await prisma.draft.create({
      data: { documentId: document.id, provider: "gemini", status: "PENDING" },
    });

    try {
      const translated = extractedText
        ? await opts.geminiService.translate({ text: extractedText, sourceLang, targetLang })
        : await opts.geminiService.translate({ fileBuffer, mimeType, sourceLang, targetLang });

      await prisma.draft.update({
        where: { id: draft.id },
        data: { draftText: translated, status: "READY" },
      });
      await prisma.order.update({ where: { id: order.id }, data: { status: "DRAFTS_READY" } });
    } catch (err) {
      await prisma.draft.update({ where: { id: draft.id }, data: { status: "FAILED" } });
      await prisma.order.update({ where: { id: order.id }, data: { status: "RECEIVED" } });
      request.log.error(err, "Gemini translation failed");
      return reply.code(502).send({ error: "AI translation failed, please retry" });
    }

    return reply.code(201).send({ orderId: order.id, documentId: document.id, draftId: draft.id });
  });

  app.post(
    "/api/documents/:id/suggest",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { text?: unknown; context?: unknown } | undefined;
      const text = body?.text;
      const context = body?.context;

      if (typeof text !== "string" || text.trim().length === 0) {
        return reply.code(400).send({ error: "text is required" });
      }
      if (typeof context !== "string" || context.trim().length === 0) {
        return reply.code(400).send({ error: "context is required" });
      }

      const document = await prisma.document.findFirst({
        where: { id, tenantId: request.professional!.tenantId },
      });
      if (!document) {
        return reply.code(404).send({ error: "Document not found" });
      }

      try {
        const suggestions = await opts.geminiService.suggest({
          text,
          context,
          sourceLang: document.sourceLang,
          targetLang: document.targetLang,
        });
        return reply.send({ suggestions });
      } catch (err) {
        request.log.error(err, "Gemini suggestion failed");
        return reply.code(502).send({ error: "AI suggestion failed, please retry" });
      }
    }
  );
}
