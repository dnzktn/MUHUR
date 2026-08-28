import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../prisma";
import type { EmailProvider } from "../services/email.service";
import type { WhatsAppProvider } from "../services/whatsapp.service";
import { notifyProfessional } from "../services/notify.service";
import { verifyQuoteToken } from "../lib/quote-token";

interface QuotesRoutesOptions {
  emailService: EmailProvider;
  whatsappService: WhatsAppProvider;
  notifyEmail: string;
  notifyWhatsappNumber: string;
  quoteTokenSecret: string;
  publicBaseUrl: string;
}

const NOTIFICATION_CHANNELS = ["email", "whatsapp"] as const;

function logNotificationFailures(
  request: FastifyRequest,
  results: PromiseSettledResult<void>[]
): void {
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      request.log.error(result.reason, `Professional notification failed (${NOTIFICATION_CHANNELS[index]})`);
    }
  });
}

function renderAcceptConfirmPage(orderId: string, priceTotal: number, token: string): string {
  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mühür — Teklifi Onayla</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <div class="site-nav">
    <div class="brand"><h3>Mühür</h3></div>
  </div>
  <div class="order-wrap">
    <h2 class="page-title">Teklifi onaylıyor musunuz?</h2>
    <p class="page-sub">${priceTotal} TL'lik fiyat teklifini kabul etmek üzeresiniz. Onaylamak için aşağıdaki butona basın.</p>
    <div class="card">
      <form method="POST" action="/api/quotes/${orderId}/accept?token=${token}">
        <button class="btn accent wide" type="submit">Teklifi Onayla</button>
      </form>
    </div>
  </div>
</body>
</html>`;
}

export async function quotesRoutes(app: FastifyInstance, opts: QuotesRoutesOptions): Promise<void> {
  app.get("/api/quotes/:orderId/accept", async (request, reply) => {
    const { orderId } = request.params as { orderId: string };
    const query = request.query as { token?: string };
    const token = query.token;

    if (!token || !verifyQuoteToken(orderId, "accept", token, opts.quoteTokenSecret)) {
      reply.redirect("/quote-invalid.html");
      return;
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.status !== "IN_REVIEW") {
      reply.redirect("/quote-invalid.html");
      return;
    }

    reply.type("text/html").send(renderAcceptConfirmPage(order.id, order.priceTotal, token));
  });

  app.post("/api/quotes/:orderId/accept", async (request, reply) => {
    const { orderId } = request.params as { orderId: string };
    const query = request.query as { token?: string };
    const token = query.token;

    if (!token || !verifyQuoteToken(orderId, "accept", token, opts.quoteTokenSecret)) {
      reply.redirect("/quote-invalid.html");
      return;
    }

    const { count } = await prisma.order.updateMany({
      where: { id: orderId, status: "IN_REVIEW" },
      data: { status: "APPROVED" },
    });
    if (count === 0) {
      reply.redirect("/quote-invalid.html");
      return;
    }

    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { customer: true } });
    if (!order) {
      reply.redirect("/quote-invalid.html");
      return;
    }

    const results = await notifyProfessional(
      opts.emailService,
      opts.whatsappService,
      opts.notifyEmail,
      opts.notifyWhatsappNumber,
      {
        subject: "Teklif Kabul Edildi",
        body: `${order.customer.name} ${order.priceTotal} TL'lik teklifi kabul etti. Sipariş: ${opts.publicBaseUrl}/workspace.html?order=${order.id}`,
      }
    );
    logNotificationFailures(request, results);

    reply.redirect("/quote-accepted.html");
  });

  app.get("/api/quotes/:orderId/reject", async (request, reply) => {
    const { orderId } = request.params as { orderId: string };
    const query = request.query as { token?: string };
    const token = query.token;

    if (!token || !verifyQuoteToken(orderId, "reject", token, opts.quoteTokenSecret)) {
      reply.redirect("/quote-invalid.html");
      return;
    }

    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { customer: true } });
    if (!order || order.status !== "IN_REVIEW") {
      reply.redirect("/quote-invalid.html");
      return;
    }

    const results = await notifyProfessional(
      opts.emailService,
      opts.whatsappService,
      opts.notifyEmail,
      opts.notifyWhatsappNumber,
      {
        subject: "Teklif Reddedildi",
        body: `${order.customer.name} ${order.priceTotal} TL'lik teklifi reddetti. Sipariş: ${opts.publicBaseUrl}/workspace.html?order=${order.id}`,
      }
    );
    logNotificationFailures(request, results);

    reply.redirect("/quote-rejected.html");
  });
}
