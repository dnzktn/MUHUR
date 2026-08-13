import { FastifyInstance } from "fastify";
import { prisma } from "../prisma";

interface CreateCustomerBody {
  name?: unknown;
  email?: unknown;
}

export async function customersRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: CreateCustomerBody }>("/api/customers", async (request, reply) => {
    const { name, email } = request.body ?? {};

    if (typeof name !== "string" || name.trim().length === 0) {
      return reply.code(400).send({ error: "name is required" });
    }
    if (typeof email !== "string" || email.trim().length === 0) {
      return reply.code(400).send({ error: "email is required" });
    }

    const trimmedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();

    const tenant = await prisma.tenant.findFirstOrThrow();

    const customer = await prisma.customer.upsert({
      where: { email: normalizedEmail },
      update: {},
      create: { tenantId: tenant.id, name: trimmedName, email: normalizedEmail },
    });

    return reply.code(201).send({ customerId: customer.id });
  });
}
