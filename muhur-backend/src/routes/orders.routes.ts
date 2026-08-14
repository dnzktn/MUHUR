import { FastifyInstance } from "fastify";
import { prisma } from "../prisma";
import { requireAuth } from "../lib/auth-guard";
import type { EmailProvider } from "../services/email.service";

interface OrdersRoutesOptions {
  emailService: EmailProvider;
}

export async function ordersRoutes(app: FastifyInstance, opts: OrdersRoutesOptions): Promise<void> {
  app.get("/api/orders", { preHandler: requireAuth }, async (request, reply) => {
    const tenantId = request.professional!.tenantId;

    const orders = await prisma.order.findMany({
      where: { tenantId },
      include: { customer: true },
      orderBy: { createdAt: "desc" },
    });

    return reply.send(
      orders.map((order) => ({
        id: order.id,
        status: order.status,
        createdAt: order.createdAt,
        customer: { name: order.customer.name, email: order.customer.email },
      }))
    );
  });

  app.get("/api/orders/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const order = await prisma.order.findFirst({
      where: { id, tenantId: request.professional!.tenantId },
      include: {
        customer: true,
        documents: { include: { drafts: true, finalTranslation: true } },
      },
    });

    if (!order) {
      return reply.code(404).send({ error: "Order not found" });
    }

    return reply.send(order);
  });

  app.patch(
    "/api/orders/:id/finalize",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { documentId?: unknown; finalText?: unknown } | undefined;
      const documentId = body?.documentId;
      const finalText = body?.finalText;
      const professional = request.professional!;

      if (typeof documentId !== "string" || documentId.trim().length === 0) {
        return reply.code(400).send({ error: "documentId is required" });
      }
      if (typeof finalText !== "string" || finalText.trim().length === 0) {
        return reply.code(400).send({ error: "finalText is required" });
      }

      const order = await prisma.order.findFirst({
        where: { id, tenantId: professional.tenantId },
      });
      if (!order) {
        return reply.code(404).send({ error: "Order not found" });
      }

      const document = await prisma.document.findUnique({ where: { id: documentId } });
      if (!document || document.orderId !== id) {
        return reply.code(400).send({ error: "Document does not belong to this order" });
      }

      const existingFinalTranslation = await prisma.finalTranslation.findUnique({
        where: { documentId },
      });
      if (existingFinalTranslation) {
        return reply.code(409).send({ error: "Document already has a final translation" });
      }

      const finalTranslation = await prisma.finalTranslation.create({
        data: {
          documentId,
          editedById: professional.professionalId,
          finalText,
        },
      });

      await prisma.order.update({ where: { id }, data: { status: "APPROVED" } });

      return reply.code(201).send(finalTranslation);
    }
  );

  app.post(
    "/api/orders/:id/send-email",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const professional = request.professional!;

      const order = await prisma.order.findFirst({
        where: { id, tenantId: professional.tenantId },
        include: {
          customer: true,
          documents: { include: { finalTranslation: true } },
        },
      });
      if (!order) {
        return reply.code(404).send({ error: "Order not found" });
      }

      const finalTranslation = order.documents
        .map((doc) => doc.finalTranslation)
        .find((translation) => translation !== null);

      if (!finalTranslation) {
        return reply.code(400).send({ error: "Order has no final translation yet" });
      }

      try {
        await opts.emailService.send({
          to: order.customer.email,
          subject: "Çeviri Belgeniz Hazır",
          text: finalTranslation.finalText,
        });
      } catch (err) {
        request.log.error(err, "Email send failed");
        return reply.code(502).send({ error: "E-posta gönderilemedi, tekrar deneyin" });
      }

      await prisma.order.update({ where: { id }, data: { status: "SENT" } });

      return reply.send({ status: "SENT" });
    }
  );
}
