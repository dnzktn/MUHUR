import { FastifyInstance } from "fastify";
import { prisma } from "../prisma";
import { requireAuth } from "../lib/auth-guard";

export async function ordersRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/orders/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const order = await prisma.order.findUnique({
      where: { id },
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
      const { documentId, finalText } = request.body as { documentId: string; finalText: string };
      const professional = request.professional!;

      const order = await prisma.order.findUnique({ where: { id } });
      if (!order) {
        return reply.code(404).send({ error: "Order not found" });
      }

      const document = await prisma.document.findUnique({ where: { id: documentId } });
      if (!document || document.orderId !== id) {
        return reply.code(400).send({ error: "Document does not belong to this order" });
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
}
