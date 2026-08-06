import Fastify, { FastifyInstance } from "fastify";
import { errorHandler } from "./lib/errors";
import { authRoutes } from "./routes/auth.routes";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });

  app.setErrorHandler(errorHandler);

  app.get("/health", async () => ({ status: "ok" }));

  app.register(authRoutes);

  return app;
}
