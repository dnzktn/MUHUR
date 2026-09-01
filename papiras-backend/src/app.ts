import Fastify, { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import staticPlugin from "@fastify/static";
import path from "node:path";
import { errorHandler } from "./lib/errors";
import { authRoutes } from "./routes/auth.routes";
import { customersRoutes } from "./routes/customers.routes";
import { documentsRoutes } from "./routes/documents.routes";
import { ordersRoutes } from "./routes/orders.routes";
import { quotesRoutes } from "./routes/quotes.routes";
import { GeminiService, TranslationProvider } from "./services/gemini.service";
import { EmailProvider, ResendEmailService } from "./services/email.service";
import { WhatsAppProvider, TwilioWhatsAppService } from "./services/whatsapp.service";

export interface BuildAppOptions {
  geminiService?: TranslationProvider;
  emailService?: EmailProvider;
  whatsappService?: WhatsAppProvider;
  notifyEmail?: string;
  notifyWhatsappNumber?: string;
  publicBaseUrl?: string;
  quoteTokenSecret?: string;
}

function getQuoteTokenSecretFromEnv(): string {
  const secret = process.env.QUOTE_TOKEN_SECRET;
  if (!secret) {
    throw new Error("QUOTE_TOKEN_SECRET is not set");
  }
  return secret;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: true });
  const geminiService = options.geminiService ?? new GeminiService(process.env.GEMINI_API_KEY ?? "");
  const emailService = options.emailService ?? new ResendEmailService(process.env.RESEND_API_KEY ?? "");
  const whatsappService =
    options.whatsappService ??
    new TwilioWhatsAppService(
      process.env.TWILIO_ACCOUNT_SID ?? "",
      process.env.TWILIO_AUTH_TOKEN ?? "",
      process.env.TWILIO_WHATSAPP_FROM ?? ""
    );
  const notifyEmail = options.notifyEmail ?? process.env.NOTIFY_EMAIL ?? "";
  const notifyWhatsappNumber = options.notifyWhatsappNumber ?? process.env.NOTIFY_WHATSAPP_NUMBER ?? "";
  const publicBaseUrl = options.publicBaseUrl ?? process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";
  const quoteTokenSecret = options.quoteTokenSecret ?? getQuoteTokenSecretFromEnv();

  app.setErrorHandler(errorHandler);
  app.register(multipart);

  app.register(staticPlugin, {
    root: path.join(__dirname, "..", "public"),
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.register(authRoutes);
  app.register(customersRoutes);
  app.register(documentsRoutes, {
    geminiService,
    emailService,
    whatsappService,
    notifyEmail,
    notifyWhatsappNumber,
    publicBaseUrl,
  });
  app.register(ordersRoutes, { emailService, quoteTokenSecret, publicBaseUrl });
  app.register(quotesRoutes, {
    emailService,
    whatsappService,
    notifyEmail,
    notifyWhatsappNumber,
    quoteTokenSecret,
    publicBaseUrl,
  });

  return app;
}
