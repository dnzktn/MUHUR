import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../prisma";
import type { EmailProvider } from "../services/email.service";
import type { WhatsAppProvider } from "../services/whatsapp.service";
import { notifyProfessional } from "../services/notify.service";
import { verifyQuoteToken, QuoteAction } from "../lib/quote-token";

interface QuotesRoutesOptions {
  emailService: EmailProvider;
  whatsappService: WhatsAppProvider;
  notifyEmail: string;
  notifyWhatsappNumber: string;
  quoteTokenSecret: string;
  publicBaseUrl: string;
}

export async function quotesRoutes(app: FastifyInstance, opts: QuotesRoutesOptions): Promise<void> {
  app.get("/api/quotes/:orderId/accept", async (request, reply) => {
    await handleQuoteResponse(request, reply, "accept", opts);
  });

  app.get("/api/quotes/:orderId/reject", async (request, reply) => {
    await handleQuoteResponse(request, reply, "reject", opts);
  });
}

async function handleQuoteResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  action: QuoteAction,
  opts: QuotesRoutesOptions
): Promise<void> {
  const { orderId } = request.params as { orderId: string };
  const query = request.query as { token?: string };
  const token = query.token;

  if (!token || !verifyQuoteToken(orderId, action, token, opts.quoteTokenSecret)) {
    reply.redirect("/quote-invalid.html");
    return;
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { customer: true },
  });
  if (!order || order.status !== "IN_REVIEW") {
    reply.redirect("/quote-invalid.html");
    return;
  }

  if (action === "accept") {
    await prisma.order.update({ where: { id: orderId }, data: { status: "APPROVED" } });
  }

  const verb = action === "accept" ? "kabul etti" : "reddetti";
  const results = await notifyProfessional(
    opts.emailService,
    opts.whatsappService,
    opts.notifyEmail,
    opts.notifyWhatsappNumber,
    {
      subject: action === "accept" ? "Teklif Kabul Edildi" : "Teklif Reddedildi",
      body: `${order.customer.name} ${order.priceTotal} TL'lik teklifi ${verb}. Sipariş: ${opts.publicBaseUrl}/workspace.html?order=${order.id}`,
    }
  );
  for (const result of results) {
    if (result.status === "rejected") {
      request.log.error(result.reason, "Professional notification failed");
    }
  }

  reply.redirect(action === "accept" ? "/quote-accepted.html" : "/quote-rejected.html");
}
