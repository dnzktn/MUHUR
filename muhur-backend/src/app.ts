import Fastify, { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import staticPlugin from "@fastify/static";
import path from "node:path";
import { errorHandler } from "./lib/errors";
import { authRoutes } from "./routes/auth.routes";
import { customersRoutes } from "./routes/customers.routes";
import { documentsRoutes } from "./routes/documents.routes";
import { ordersRoutes } from "./routes/orders.routes";
import { GeminiService, TranslationProvider } from "./services/gemini.service";
import { EmailProvider, ResendEmailService } from "./services/email.service";

export interface BuildAppOptions {
  geminiService?: TranslationProvider;
  emailService?: EmailProvider;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: true });
  const geminiService = options.geminiService ?? new GeminiService(process.env.GEMINI_API_KEY ?? "");
  const emailService = options.emailService ?? new ResendEmailService(process.env.RESEND_API_KEY ?? "");

  app.setErrorHandler(errorHandler);
  app.register(multipart);

  app.register(staticPlugin, {
    root: path.join(__dirname, "..", "public"),
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.register(authRoutes);
  app.register(customersRoutes);
  app.register(documentsRoutes, { geminiService });
  app.register(ordersRoutes, { emailService });

  return app;
}
