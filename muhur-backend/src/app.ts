import Fastify, { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { errorHandler } from "./lib/errors";
import { authRoutes } from "./routes/auth.routes";
import { documentsRoutes } from "./routes/documents.routes";
import { GeminiService, TranslationProvider } from "./services/gemini.service";

export interface BuildAppOptions {
  geminiService?: TranslationProvider;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: true });
  const geminiService = options.geminiService ?? new GeminiService(process.env.GEMINI_API_KEY ?? "");

  app.setErrorHandler(errorHandler);
  app.register(multipart);

  app.get("/health", async () => ({ status: "ok" }));

  app.register(authRoutes);
  app.register(documentsRoutes, { geminiService });

  return app;
}
