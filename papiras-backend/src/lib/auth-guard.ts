import { FastifyReply, FastifyRequest } from "fastify";
import { verifyAuthToken, AuthTokenPayload } from "./jwt";

declare module "fastify" {
  interface FastifyRequest {
    professional?: AuthTokenPayload;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Missing authorization token" });
    return;
  }

  const token = header.slice("Bearer ".length);
  try {
    request.professional = verifyAuthToken(token);
  } catch {
    reply.code(401).send({ error: "Invalid or expired token" });
  }
}
