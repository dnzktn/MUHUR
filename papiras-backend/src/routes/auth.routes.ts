import { FastifyInstance } from "fastify";
import { prisma } from "../prisma";
import { verifyPassword } from "../lib/password";
import { signAuthToken } from "../lib/jwt";

interface LoginBody {
  email: string;
  password: string;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: LoginBody }>("/api/auth/login", async (request, reply) => {
    const { email, password } = request.body;

    const professional = await prisma.verifiedProfessional.findUnique({ where: { email } });
    if (!professional) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const valid = await verifyPassword(password, professional.passwordHash);
    if (!valid) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const token = signAuthToken({
      professionalId: professional.id,
      email: professional.email,
      tenantId: professional.tenantId,
    });
    return reply.send({ token });
  });
}
