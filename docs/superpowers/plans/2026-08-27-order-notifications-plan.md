# Mühür — Sipariş Bildirimleri & Teklif Yanıtı Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Yeni sipariş geldiğinde ve müşteri bir fiyat teklifine (e-postadaki linkten) kabul/red yanıtı verdiğinde profesyonele (Yağmur) hem e-posta hem WhatsApp bildirimi göndermek.

**Architecture:** `WhatsAppProvider`/`TwilioWhatsAppService`, mevcut `EmailProvider`/`ResendEmailService` deseninin birebir kopyası olarak eklenir. Bir `notifyProfessional` yardımcı fonksiyonu her iki kanala paralel gönderim yapar, hatayı yutmaz ama fırlatmaz da (`Promise.allSettled`) — çağıran route loglar. Teklif kabul/red linkleri, DB'de saklanmayan HMAC imzalı token'lar kullanır (`crypto.createHmac`), geçerlilik sadece `Order.status === "IN_REVIEW"` kontrolüyle sağlanır — ayrı bir süre dolumu mekanizması yok.

**Tech Stack:** Fastify, Prisma, PostgreSQL, Vitest, `resend` (mevcut), `twilio` (yeni npm paketi). Node'un yerleşik `crypto` modülü token imzalama için.

## Global Constraints

- Şema değişikliği yok — `Order.status` geçişleri mevcut enum değerlerini kullanır (`IN_REVIEW` → `APPROVED`), yeni bir statü eklenmez.
- Bildirim gönderimi (e-posta veya WhatsApp) başarısız olursa müşterinin işlemi (sipariş oluşturma / teklif yanıtlama) asla engellenmez veya geciktirilmez — hata sadece loglanır.
- Bildirim alıcısı şimdilik sabit, tek bir hedef: `.env`'deki `NOTIFY_EMAIL` ve `NOTIFY_WHATSAPP_NUMBER`.
- Kabul/red linklerindeki token DB'de saklanmaz, `HMAC-SHA256(orderId + ":" + action, QUOTE_TOKEN_SECRET)` ile anlık hesaplanır/doğrulanır.
- Kabul edilen teklif statüyü `APPROVED`'a taşır (Yağmur'un manuel "Onayla" butonuyla aynı hedef statü). Reddedilen teklif statüyü değiştirmez.
- Ödeme entegrasyonu bu planın kapsamı dışındadır — kabul sayfası sadece "ödeme adımı yakında eklenecek" mesajı gösterir.
- Postgres Docker üzerinde host port `5433`'te çalışır; testler `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run` ile çalıştırılır; dev server `npx dotenv -e .env -- npm run dev` ile.

---

## File Structure

```
muhur-backend/
  src/
    services/
      whatsapp.service.ts     # new: WhatsAppProvider interface + TwilioWhatsAppService
      notify.service.ts       # new: notifyProfessional (parallel email+WhatsApp send)
    lib/
      quote-token.ts          # new: signQuoteToken / verifyQuoteToken (HMAC)
    routes/
      documents.routes.ts     # modified: notify professional after successful order creation
      orders.routes.ts        # modified: send-quote email includes accept/reject links
      quotes.routes.ts        # new: GET /api/quotes/:orderId/accept, /reject
    app.ts                   # modified: wire whatsappService, notify config, quote token config, register quotesRoutes
  test/
    services/
      whatsapp.test.ts        # new
      notify.test.ts          # new
    lib/
      quote-token.test.ts     # new
    routes/
      documents.test.ts       # modified: notification assertions + fake providers on existing success tests
      orders.test.ts          # modified: new test for accept/reject links in quote email
      quotes.test.ts          # new
  public/
    quote-accepted.html       # new
    quote-rejected.html       # new
    quote-invalid.html        # new
  .env                        # modified: new env vars (placeholder values, user fills in real ones)
  .env.example                # modified: same new env vars, generic placeholders
  .env.test                   # modified: same new env vars, dummy test values
  package.json                # modified: add "twilio" dependency
```

---

### Task 1: `WhatsAppProvider` Interface + `TwilioWhatsAppService`

**Files:**
- Create: `muhur-backend/src/services/whatsapp.service.ts`
- Test: `muhur-backend/test/services/whatsapp.test.ts`
- Modify: `muhur-backend/.env`, `muhur-backend/.env.example`, `muhur-backend/.env.test`, `muhur-backend/package.json`

**Interfaces:**
- Produces: `SendWhatsAppInput` (`{ to: string; text: string }`), `WhatsAppProvider` interface (`send(input: SendWhatsAppInput): Promise<void>`), `TwilioWhatsAppService implements WhatsAppProvider` with constructor `(accountSid: string, authToken: string, fromNumber: string)`. Task 2's `notify.service.ts` and Task 4/5/6 consume this type.

- [ ] **Step 1: Install the Twilio SDK**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR/muhur-backend"
npm install twilio
```

- [ ] **Step 2: Add new environment variables**

Append to `muhur-backend/.env` (after the existing `RESEND_API_KEY` line, before `PORT=3000`):

```
TWILIO_ACCOUNT_SID="your-twilio-account-sid"
TWILIO_AUTH_TOKEN="your-twilio-auth-token"
TWILIO_WHATSAPP_FROM="whatsapp:+14155238886"
NOTIFY_EMAIL="your-notify-email@example.com"
NOTIFY_WHATSAPP_NUMBER="+90XXXXXXXXXX"
QUOTE_TOKEN_SECRET="dev-quote-secret-change-me"
PUBLIC_BASE_URL="http://localhost:3000"
```

Append the same block to `muhur-backend/.env.example` (identical placeholder text — this file documents the shape, not real secrets).

Append to `muhur-backend/.env.test` (after the existing `RESEND_API_KEY` line):

```
TWILIO_ACCOUNT_SID="unused-in-tests"
TWILIO_AUTH_TOKEN="unused-in-tests"
TWILIO_WHATSAPP_FROM="whatsapp:+15005550006"
NOTIFY_EMAIL="unused-in-tests@example.com"
NOTIFY_WHATSAPP_NUMBER="+15005550006"
QUOTE_TOKEN_SECRET="test-secret"
PUBLIC_BASE_URL="http://localhost:3000"
```

- [ ] **Step 3: Write the failing test**

`muhur-backend/test/services/whatsapp.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();

vi.mock("twilio", () => ({
  default: vi.fn().mockImplementation(() => ({ messages: { create: createMock } })),
}));

import { TwilioWhatsAppService } from "../../src/services/whatsapp.service";

describe("TwilioWhatsAppService", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("sends a WhatsApp message with the whatsapp: prefix on the recipient", async () => {
    createMock.mockResolvedValue({ sid: "SM123" });

    const service = new TwilioWhatsAppService("fake-sid", "fake-token", "whatsapp:+14155238886");
    await service.send({ to: "+905551234567", text: "Yeni sipariş geldi." });

    expect(createMock).toHaveBeenCalledWith({
      from: "whatsapp:+14155238886",
      to: "whatsapp:+905551234567",
      body: "Yeni sipariş geldi.",
    });
  });

  it("propagates an error when the Twilio API call fails", async () => {
    createMock.mockRejectedValue(new Error("Invalid phone number"));

    const service = new TwilioWhatsAppService("fake-sid", "fake-token", "whatsapp:+14155238886");
    await expect(
      service.send({ to: "+905551234567", text: "Test" })
    ).rejects.toThrow("Invalid phone number");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run test/services/whatsapp.test.ts`
Expected: FAIL — `Cannot find module '../../src/services/whatsapp.service'`

- [ ] **Step 5: Write `src/services/whatsapp.service.ts`**

```typescript
import twilio from "twilio";

export interface SendWhatsAppInput {
  to: string;
  text: string;
}

export interface WhatsAppProvider {
  send(input: SendWhatsAppInput): Promise<void>;
}

export class TwilioWhatsAppService implements WhatsAppProvider {
  private accountSid: string;
  private authToken: string;
  private fromNumber: string;
  private client: ReturnType<typeof twilio> | null = null;

  constructor(accountSid: string, authToken: string, fromNumber: string) {
    this.accountSid = accountSid;
    this.authToken = authToken;
    this.fromNumber = fromNumber;
  }

  private getClient(): ReturnType<typeof twilio> {
    if (!this.client) {
      this.client = twilio(this.accountSid, this.authToken);
    }
    return this.client;
  }

  async send(input: SendWhatsAppInput): Promise<void> {
    await this.getClient().messages.create({
      from: this.fromNumber,
      to: `whatsapp:${input.to}`,
      body: input.text,
    });
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run test/services/whatsapp.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: add Twilio WhatsApp service with mockable provider interface"
```

---

### Task 2: `notifyProfessional` Helper

**Files:**
- Create: `muhur-backend/src/services/notify.service.ts`
- Test: `muhur-backend/test/services/notify.test.ts`

**Interfaces:**
- Consumes: `EmailProvider` (Task 1 area — already exists in `src/services/email.service.ts`), `WhatsAppProvider` (Task 1).
- Produces: `notifyProfessional(emailService: EmailProvider, whatsappService: WhatsAppProvider, notifyEmail: string, notifyWhatsappNumber: string, message: { subject: string; body: string }): Promise<PromiseSettledResult<void>[]>`. Tasks 4, 5(indirectly via Task 6), and 6 call this and inspect the returned array for `status === "rejected"` entries to log.

- [ ] **Step 1: Write the failing test**

`muhur-backend/test/services/notify.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { notifyProfessional } from "../../src/services/notify.service";
import type { EmailProvider } from "../../src/services/email.service";
import type { WhatsAppProvider } from "../../src/services/whatsapp.service";

describe("notifyProfessional", () => {
  it("sends both an email and a WhatsApp message with the same body", async () => {
    const emailService: EmailProvider = { send: vi.fn().mockResolvedValue(undefined) };
    const whatsappService: WhatsAppProvider = { send: vi.fn().mockResolvedValue(undefined) };

    const results = await notifyProfessional(
      emailService,
      whatsappService,
      "yagmur@muhur.com",
      "+905551234567",
      { subject: "Yeni Sipariş", body: "Yeni sipariş: Ahmet Yılmaz — TR→EN." }
    );

    expect(emailService.send).toHaveBeenCalledWith({
      to: "yagmur@muhur.com",
      subject: "Yeni Sipariş",
      text: "Yeni sipariş: Ahmet Yılmaz — TR→EN.",
    });
    expect(whatsappService.send).toHaveBeenCalledWith({
      to: "+905551234567",
      text: "Yeni sipariş: Ahmet Yılmaz — TR→EN.",
    });
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  });

  it("reports a rejected result for the channel that fails, without throwing", async () => {
    const emailService: EmailProvider = { send: vi.fn().mockResolvedValue(undefined) };
    const whatsappService: WhatsAppProvider = {
      send: vi.fn().mockRejectedValue(new Error("Twilio error")),
    };

    const results = await notifyProfessional(
      emailService,
      whatsappService,
      "yagmur@muhur.com",
      "+905551234567",
      { subject: "Test", body: "Test body" }
    );

    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run test/services/notify.test.ts`
Expected: FAIL — `Cannot find module '../../src/services/notify.service'`

- [ ] **Step 3: Write `src/services/notify.service.ts`**

```typescript
import type { EmailProvider } from "./email.service";
import type { WhatsAppProvider } from "./whatsapp.service";

export interface NotifyMessage {
  subject: string;
  body: string;
}

export async function notifyProfessional(
  emailService: EmailProvider,
  whatsappService: WhatsAppProvider,
  notifyEmail: string,
  notifyWhatsappNumber: string,
  message: NotifyMessage
): Promise<PromiseSettledResult<void>[]> {
  return Promise.allSettled([
    emailService.send({ to: notifyEmail, subject: message.subject, text: message.body }),
    whatsappService.send({ to: notifyWhatsappNumber, text: message.body }),
  ]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run test/services/notify.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: add notifyProfessional helper for parallel email+WhatsApp delivery"
```

---

### Task 3: Quote Token Signing/Verification

**Files:**
- Create: `muhur-backend/src/lib/quote-token.ts`
- Test: `muhur-backend/test/lib/quote-token.test.ts`

**Interfaces:**
- Produces: `type QuoteAction = "accept" | "reject"`, `signQuoteToken(orderId: string, action: QuoteAction, secret: string): string`, `verifyQuoteToken(orderId: string, action: QuoteAction, token: string, secret: string): boolean`. Task 5 (orders.routes.ts) calls `signQuoteToken` to build email links; Task 6 (quotes.routes.ts) calls `verifyQuoteToken` to validate incoming requests.

- [ ] **Step 1: Write the failing test**

`muhur-backend/test/lib/quote-token.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { signQuoteToken, verifyQuoteToken } from "../../src/lib/quote-token";

describe("quote-token", () => {
  it("produces a token that verifies successfully for the same orderId, action, and secret", () => {
    const token = signQuoteToken("order-123", "accept", "test-secret");
    expect(verifyQuoteToken("order-123", "accept", token, "test-secret")).toBe(true);
  });

  it("fails verification when the action does not match", () => {
    const token = signQuoteToken("order-123", "accept", "test-secret");
    expect(verifyQuoteToken("order-123", "reject", token, "test-secret")).toBe(false);
  });

  it("fails verification when the orderId does not match", () => {
    const token = signQuoteToken("order-123", "accept", "test-secret");
    expect(verifyQuoteToken("order-456", "accept", token, "test-secret")).toBe(false);
  });

  it("fails verification when the secret does not match", () => {
    const token = signQuoteToken("order-123", "accept", "test-secret");
    expect(verifyQuoteToken("order-123", "accept", token, "different-secret")).toBe(false);
  });

  it("fails verification for a malformed token instead of throwing", () => {
    expect(() =>
      verifyQuoteToken("order-123", "accept", "not-a-valid-hex-token!!", "test-secret")
    ).not.toThrow();
    expect(verifyQuoteToken("order-123", "accept", "not-a-valid-hex-token!!", "test-secret")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run test/lib/quote-token.test.ts`
Expected: FAIL — `Cannot find module '../../src/lib/quote-token'`

- [ ] **Step 3: Write `src/lib/quote-token.ts`**

```typescript
import crypto from "node:crypto";

export type QuoteAction = "accept" | "reject";

export function signQuoteToken(orderId: string, action: QuoteAction, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`${orderId}:${action}`).digest("hex");
}

export function verifyQuoteToken(
  orderId: string,
  action: QuoteAction,
  token: string,
  secret: string
): boolean {
  const expected = signQuoteToken(orderId, action, secret);
  const expectedBuf = Buffer.from(expected, "hex");
  const tokenBuf = Buffer.from(token, "hex");

  if (expectedBuf.length !== tokenBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, tokenBuf);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run test/lib/quote-token.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: add HMAC-based quote token signing and verification"
```

---

### Task 4: New Order Notification

**Files:**
- Modify: `muhur-backend/src/app.ts`
- Modify: `muhur-backend/src/routes/documents.routes.ts`
- Modify: `muhur-backend/test/routes/documents.test.ts`

**Interfaces:**
- Consumes: `WhatsAppProvider`/`TwilioWhatsAppService` (Task 1), `notifyProfessional` (Task 2).
- Produces: `BuildAppOptions` gains `whatsappService?`, `notifyEmail?`, `notifyWhatsappNumber?`, `publicBaseUrl?` (all optional, default from `process.env`). `DocumentsRoutesOptions` gains `emailService`, `whatsappService`, `notifyEmail`, `notifyWhatsappNumber`, `publicBaseUrl` (all required, passed by `app.ts`). Task 5 and Task 6 reuse the same `BuildAppOptions` fields (`quoteTokenSecret`, `publicBaseUrl` — Task 5 adds `quoteTokenSecret`).

- [ ] **Step 1: Add the failing tests**

In `muhur-backend/test/routes/documents.test.ts`, add this import near the top (alongside the existing imports):

```typescript
import type { EmailProvider } from "../../src/services/email.service";
import type { WhatsAppProvider } from "../../src/services/whatsapp.service";
```

Add these two tests inside the existing `describe("POST /api/documents", ...)` block, after the `"extracts text from an uploaded docx file before translating"` test:

```typescript
  it("notifies the professional by email and WhatsApp after a successful translation", async () => {
    const customer = await seedCustomer();
    const geminiService = fakeProvider();
    const emailService: EmailProvider = { send: vi.fn().mockResolvedValue(undefined) };
    const whatsappService: WhatsAppProvider = { send: vi.fn().mockResolvedValue(undefined) };
    const app = buildApp({
      geminiService,
      emailService,
      whatsappService,
      notifyEmail: "yagmur@muhur.com",
      notifyWhatsappNumber: "+905551234567",
      publicBaseUrl: "http://localhost:3000",
    });

    const form = new FormData();
    form.append("customerId", customer.id);
    form.append("sourceLang", "TR");
    form.append("targetLang", "EN");
    form.append("pastedText", "Bu belge nüfus cüzdanı örneğidir.");

    const res = await app.inject({
      method: "POST",
      url: "/api/documents",
      headers: form.getHeaders(),
      payload: form.getBuffer(),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();

    expect(emailService.send).toHaveBeenCalledWith({
      to: "yagmur@muhur.com",
      subject: "Yeni Sipariş",
      text: expect.stringContaining(`http://localhost:3000/workspace.html?order=${body.orderId}`),
    });
    expect(whatsappService.send).toHaveBeenCalledWith({
      to: "+905551234567",
      text: expect.stringContaining("Demo Müşteri"),
    });
  });

  it("still returns 201 even if both notification channels fail", async () => {
    const customer = await seedCustomer();
    const geminiService = fakeProvider();
    const emailService: EmailProvider = { send: vi.fn().mockRejectedValue(new Error("Resend down")) };
    const whatsappService: WhatsAppProvider = { send: vi.fn().mockRejectedValue(new Error("Twilio down")) };
    const app = buildApp({
      geminiService,
      emailService,
      whatsappService,
      notifyEmail: "yagmur@muhur.com",
      notifyWhatsappNumber: "+905551234567",
    });

    const form = new FormData();
    form.append("customerId", customer.id);
    form.append("sourceLang", "TR");
    form.append("targetLang", "EN");
    form.append("pastedText", "Bu belge nüfus cüzdanı örneğidir.");

    const res = await app.inject({
      method: "POST",
      url: "/api/documents",
      headers: form.getHeaders(),
      payload: form.getBuffer(),
    });

    expect(res.statusCode).toBe(201);
  });
```

Also update the two existing successful-path tests so they do not trigger a real network call now that `POST /api/documents` calls `opts.emailService`/`opts.whatsappService`. Change the `buildApp({ geminiService })` call in `"creates an order, document, and ready draft from pasted text"` and in `"extracts text from an uploaded docx file before translating"` to:

```typescript
    const app = buildApp({
      geminiService,
      emailService: { send: vi.fn().mockResolvedValue(undefined) },
      whatsappService: { send: vi.fn().mockResolvedValue(undefined) },
    });
```

(Both occurrences — there are exactly two `buildApp({ geminiService })` calls in successful-path tests in this file; the `502`-path test and the two `400`-path tests never reach the notification code and do not need this change.)

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run test/routes/documents.test.ts`
Expected: FAIL — `buildApp` does not accept `whatsappService`/`notifyEmail`/`notifyWhatsappNumber`/`publicBaseUrl` yet (TypeScript compile error), and the two new tests fail because no notification is sent.

- [ ] **Step 3: Update `src/app.ts`**

Add the import:

```typescript
import { WhatsAppProvider, TwilioWhatsAppService } from "./services/whatsapp.service";
```

Update `BuildAppOptions`:

```typescript
export interface BuildAppOptions {
  geminiService?: TranslationProvider;
  emailService?: EmailProvider;
  whatsappService?: WhatsAppProvider;
  notifyEmail?: string;
  notifyWhatsappNumber?: string;
  publicBaseUrl?: string;
}
```

Inside `buildApp`, add the default construction (alongside the existing `emailService` line):

```typescript
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
```

Update the `documentsRoutes` registration:

```typescript
  app.register(documentsRoutes, {
    geminiService,
    emailService,
    whatsappService,
    notifyEmail,
    notifyWhatsappNumber,
    publicBaseUrl,
  });
```

- [ ] **Step 4: Update `src/routes/documents.routes.ts`**

Add imports at the top:

```typescript
import type { EmailProvider } from "../services/email.service";
import type { WhatsAppProvider } from "../services/whatsapp.service";
import { notifyProfessional } from "../services/notify.service";
```

Change `DocumentsRoutesOptions`:

```typescript
interface DocumentsRoutesOptions {
  geminiService: TranslationProvider;
  emailService: EmailProvider;
  whatsappService: WhatsAppProvider;
  notifyEmail: string;
  notifyWhatsappNumber: string;
  publicBaseUrl: string;
}
```

Find this block (the success path, right before the final `return`):

```typescript
      await prisma.draft.update({
        where: { id: draft.id },
        data: { draftText: translated, status: "READY" },
      });
      await prisma.order.update({ where: { id: order.id }, data: { status: "DRAFTS_READY" } });
    } catch (err) {
      await prisma.draft.update({ where: { id: draft.id }, data: { status: "FAILED" } });
      await prisma.order.update({ where: { id: order.id }, data: { status: "RECEIVED" } });
      request.log.error(err, "Gemini translation failed");
      return reply.code(502).send({ error: "AI translation failed, please retry" });
    }

    return reply.code(201).send({ orderId: order.id, documentId: document.id, draftId: draft.id });
```

Replace it with:

```typescript
      await prisma.draft.update({
        where: { id: draft.id },
        data: { draftText: translated, status: "READY" },
      });
      await prisma.order.update({ where: { id: order.id }, data: { status: "DRAFTS_READY" } });
    } catch (err) {
      await prisma.draft.update({ where: { id: draft.id }, data: { status: "FAILED" } });
      await prisma.order.update({ where: { id: order.id }, data: { status: "RECEIVED" } });
      request.log.error(err, "Gemini translation failed");
      return reply.code(502).send({ error: "AI translation failed, please retry" });
    }

    const notifyResults = await notifyProfessional(
      opts.emailService,
      opts.whatsappService,
      opts.notifyEmail,
      opts.notifyWhatsappNumber,
      {
        subject: "Yeni Sipariş",
        body: `Yeni sipariş: ${customer.name} — ${sourceLang}→${targetLang}. Panelden incele: ${opts.publicBaseUrl}/workspace.html?order=${order.id}`,
      }
    );
    for (const result of notifyResults) {
      if (result.status === "rejected") {
        request.log.error(result.reason, "Professional notification failed");
      }
    }

    return reply.code(201).send({ orderId: order.id, documentId: document.id, draftId: draft.id });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run test/routes/documents.test.ts`
Expected: PASS (all tests in the file, including the 2 new ones)

- [ ] **Step 6: Run the full suite to check for regressions**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: notify professional by email and WhatsApp on new order"
```

---

### Task 5: Accept/Reject Links in the Quote Email

**Files:**
- Modify: `muhur-backend/src/app.ts`
- Modify: `muhur-backend/src/routes/orders.routes.ts`
- Modify: `muhur-backend/test/routes/orders.test.ts`

**Interfaces:**
- Consumes: `signQuoteToken` (Task 3).
- Produces: `BuildAppOptions` gains `quoteTokenSecret?` (optional, defaults from `process.env.QUOTE_TOKEN_SECRET`). `OrdersRoutesOptions` gains `quoteTokenSecret: string` and `publicBaseUrl: string` (required). Task 6 reuses the same `quoteTokenSecret`/`publicBaseUrl` `BuildAppOptions` fields.

- [ ] **Step 1: Add the failing test**

In `muhur-backend/test/routes/orders.test.ts`, add this import near the top:

```typescript
import { verifyQuoteToken } from "../../src/lib/quote-token";
```

Add this test inside the existing `describe("POST /api/orders/:id/send-quote", ...)` block, after the last existing test (`"allows sending a quote twice — resending with an updated price is not blocked"`):

```typescript
  it("includes valid, verifiable accept and reject links in the quote email", async () => {
    const { order, professional } = await seedOrderWithDraft();
    const token = signAuthToken({
      professionalId: professional.id,
      email: professional.email,
      tenantId: professional.tenantId,
    });
    const emailService = fakeEmailProvider();
    const app = buildApp({
      emailService,
      quoteTokenSecret: "test-quote-secret",
      publicBaseUrl: "http://localhost:3000",
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/orders/${order.id}/send-quote`,
      headers: { authorization: `Bearer ${token}` },
      payload: { priceTotal: 360 },
    });

    expect(res.statusCode).toBe(200);

    const sentText = (emailService.send as ReturnType<typeof vi.fn>).mock.calls[0][0].text as string;
    const acceptMatch = sentText.match(/accept\?token=([a-f0-9]+)/);
    const rejectMatch = sentText.match(/reject\?token=([a-f0-9]+)/);

    expect(acceptMatch).not.toBeNull();
    expect(rejectMatch).not.toBeNull();
    expect(verifyQuoteToken(order.id, "accept", acceptMatch![1], "test-quote-secret")).toBe(true);
    expect(verifyQuoteToken(order.id, "reject", rejectMatch![1], "test-quote-secret")).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run test/routes/orders.test.ts`
Expected: FAIL — `buildApp` does not accept `quoteTokenSecret` yet (compile error), and the email body has no links.

- [ ] **Step 3: Update `src/app.ts`**

No new import needed here — `quoteTokenSecret` is passed through `app.ts` as a plain string; `signQuoteToken` itself is only called from `orders.routes.ts` (Step 4).

Update `BuildAppOptions`:

```typescript
export interface BuildAppOptions {
  geminiService?: TranslationProvider;
  emailService?: EmailProvider;
  whatsappService?: WhatsAppProvider;
  notifyEmail?: string;
  notifyWhatsappNumber?: string;
  quoteTokenSecret?: string;
  publicBaseUrl?: string;
}
```

Inside `buildApp`, add:

```typescript
  const quoteTokenSecret = options.quoteTokenSecret ?? process.env.QUOTE_TOKEN_SECRET ?? "";
```

Update the `ordersRoutes` registration:

```typescript
  app.register(ordersRoutes, { emailService, quoteTokenSecret, publicBaseUrl });
```

- [ ] **Step 4: Update `src/routes/orders.routes.ts`**

Add the import:

```typescript
import { signQuoteToken } from "../lib/quote-token";
```

Change `OrdersRoutesOptions`:

```typescript
interface OrdersRoutesOptions {
  emailService: EmailProvider;
  quoteTokenSecret: string;
  publicBaseUrl: string;
}
```

Find this block inside the `send-quote` handler:

```typescript
      try {
        await opts.emailService.send({
          to: order.customer.email,
          subject: "Çeviri Teklifiniz Hazır",
          text: `Merhaba, çeviri talebiniz için fiyat teklifimiz: ${priceTotal} TL. Bu teklifi kabul etmek isterseniz bizimle iletişime geçebilirsiniz.`,
        });
      } catch (err) {
```

Replace it with:

```typescript
      const acceptToken = signQuoteToken(order.id, "accept", opts.quoteTokenSecret);
      const rejectToken = signQuoteToken(order.id, "reject", opts.quoteTokenSecret);
      const quoteEmailText = `Merhaba, çeviri talebiniz için fiyat teklifimiz: ${priceTotal} TL.

Teklifi kabul etmek için: ${opts.publicBaseUrl}/api/quotes/${order.id}/accept?token=${acceptToken}
Teklifi reddetmek için: ${opts.publicBaseUrl}/api/quotes/${order.id}/reject?token=${rejectToken}`;

      try {
        await opts.emailService.send({
          to: order.customer.email,
          subject: "Çeviri Teklifiniz Hazır",
          text: quoteEmailText,
        });
      } catch (err) {
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run test/routes/orders.test.ts`
Expected: PASS (all tests in the file, including the new one)

- [ ] **Step 6: Run the full suite to check for regressions**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: add signed accept/reject links to the quote email"
```

---

### Task 6: `GET /api/quotes/:orderId/accept` and `/reject`

**Files:**
- Create: `muhur-backend/src/routes/quotes.routes.ts`
- Modify: `muhur-backend/src/app.ts`
- Test: `muhur-backend/test/routes/quotes.test.ts`

**Interfaces:**
- Consumes: `verifyQuoteToken` (Task 3), `notifyProfessional` (Task 2), `EmailProvider`/`WhatsAppProvider` (existing/Task 1).
- Produces: `GET /api/quotes/:orderId/accept?token=...` and `GET /api/quotes/:orderId/reject?token=...` — both public (no auth), respond with a `302` redirect to `/quote-accepted.html`, `/quote-rejected.html`, or `/quote-invalid.html`. Task 7's static pages are the redirect targets; nothing in Task 7 depends on this task's internals beyond those three exact filenames.

- [ ] **Step 1: Write the failing test**

`muhur-backend/test/routes/quotes.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { buildApp } from "../../src/app";
import { prisma } from "../../src/prisma";
import { resetDb } from "../helpers/reset-db";
import { signQuoteToken } from "../../src/lib/quote-token";
import type { EmailProvider } from "../../src/services/email.service";
import type { WhatsAppProvider } from "../../src/services/whatsapp.service";

const SECRET = "test-quote-secret";

async function seedOrderInReview() {
  const tenant = await prisma.tenant.create({ data: { name: "Mühür" } });
  const customer = await prisma.customer.create({
    data: { tenantId: tenant.id, name: "Demo Müşteri", email: "demo@musteri.com" },
  });
  const order = await prisma.order.create({
    data: { tenantId: tenant.id, customerId: customer.id, status: "IN_REVIEW", priceTotal: 360 },
  });
  return order;
}

function fakeProviders() {
  const emailService: EmailProvider = { send: vi.fn().mockResolvedValue(undefined) };
  const whatsappService: WhatsAppProvider = { send: vi.fn().mockResolvedValue(undefined) };
  return { emailService, whatsappService };
}

describe("GET /api/quotes/:orderId/accept", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("approves the order and redirects to the accepted page with a valid token", async () => {
    const order = await seedOrderInReview();
    const { emailService, whatsappService } = fakeProviders();
    const app = buildApp({
      emailService,
      whatsappService,
      notifyEmail: "yagmur@muhur.com",
      notifyWhatsappNumber: "+905551234567",
      quoteTokenSecret: SECRET,
      publicBaseUrl: "http://localhost:3000",
    });
    const token = signQuoteToken(order.id, "accept", SECRET);

    const res = await app.inject({
      method: "GET",
      url: `/api/quotes/${order.id}/accept?token=${token}`,
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/quote-accepted.html");

    const updated = await prisma.order.findUnique({ where: { id: order.id } });
    expect(updated?.status).toBe("APPROVED");

    expect(emailService.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "yagmur@muhur.com", subject: "Teklif Kabul Edildi" })
    );
    expect(whatsappService.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "+905551234567" })
    );
  });

  it("redirects to the invalid page with a wrong token, without changing status", async () => {
    const order = await seedOrderInReview();
    const { emailService, whatsappService } = fakeProviders();
    const app = buildApp({
      emailService,
      whatsappService,
      notifyEmail: "yagmur@muhur.com",
      notifyWhatsappNumber: "+905551234567",
      quoteTokenSecret: SECRET,
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/quotes/${order.id}/accept?token=wrong-token`,
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/quote-invalid.html");

    const updated = await prisma.order.findUnique({ where: { id: order.id } });
    expect(updated?.status).toBe("IN_REVIEW");
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it("redirects to the invalid page when the order is no longer IN_REVIEW", async () => {
    const order = await seedOrderInReview();
    await prisma.order.update({ where: { id: order.id }, data: { status: "APPROVED" } });
    const { emailService, whatsappService } = fakeProviders();
    const app = buildApp({
      emailService,
      whatsappService,
      notifyEmail: "yagmur@muhur.com",
      notifyWhatsappNumber: "+905551234567",
      quoteTokenSecret: SECRET,
    });
    const token = signQuoteToken(order.id, "accept", SECRET);

    const res = await app.inject({
      method: "GET",
      url: `/api/quotes/${order.id}/accept?token=${token}`,
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/quote-invalid.html");
  });
});

describe("GET /api/quotes/:orderId/reject", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("does not change status, notifies the professional, and redirects to the rejected page", async () => {
    const order = await seedOrderInReview();
    const { emailService, whatsappService } = fakeProviders();
    const app = buildApp({
      emailService,
      whatsappService,
      notifyEmail: "yagmur@muhur.com",
      notifyWhatsappNumber: "+905551234567",
      quoteTokenSecret: SECRET,
    });
    const token = signQuoteToken(order.id, "reject", SECRET);

    const res = await app.inject({
      method: "GET",
      url: `/api/quotes/${order.id}/reject?token=${token}`,
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/quote-rejected.html");

    const updated = await prisma.order.findUnique({ where: { id: order.id } });
    expect(updated?.status).toBe("IN_REVIEW");

    expect(emailService.send).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Teklif Reddedildi" })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run test/routes/quotes.test.ts`
Expected: FAIL — route `/api/quotes/:orderId/accept` returns `404` (not registered yet)

- [ ] **Step 3: Create `src/routes/quotes.routes.ts`**

```typescript
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
```

- [ ] **Step 4: Register the route in `src/app.ts`**

Add the import:

```typescript
import { quotesRoutes } from "./routes/quotes.routes";
```

Add the registration (after `app.register(ordersRoutes, ...)`):

```typescript
  app.register(quotesRoutes, {
    emailService,
    whatsappService,
    notifyEmail,
    notifyWhatsappNumber,
    quoteTokenSecret,
    publicBaseUrl,
  });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run test/routes/quotes.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Run the full suite to check for regressions**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: add public quote accept/reject endpoints"
```

---

### Task 7: Customer-Facing Confirmation Pages

**Files:**
- Create: `muhur-backend/public/quote-accepted.html`
- Create: `muhur-backend/public/quote-rejected.html`
- Create: `muhur-backend/public/quote-invalid.html`

**Interfaces:**
- Consumes: nothing (static pages). Task 6's redirects target these three exact filenames — do not rename them.

- [ ] **Step 1: Create `public/quote-accepted.html`**

```html
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mühür — Teklif Kabul Edildi</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <div class="site-nav">
    <div class="brand"><h3>Mühür</h3></div>
  </div>
  <div class="order-wrap">
    <h2 class="page-title">Teklifi kabul ettiniz</h2>
    <p class="page-sub">Teşekkürler! Ödeme adımı yakında eklenecek, ekibimiz sizinle en kısa sürede iletişime geçecek.</p>
    <div class="card">
      <p style="color: var(--ink-2); font-size: 14px; line-height: 1.7; margin: 0;">Herhangi bir sorunuz olursa <a href="/order-form.html" style="color: var(--accent);">sipariş formu</a> üzerinden bize ulaşabilirsiniz.</p>
    </div>
  </div>
  <footer class="site-footer">
    <div class="footer-grid">
      <div class="footer-brand">
        <h3>Mühür</h3>
        <p>Hızlı ve güvenilir yeminli çeviri hizmeti.<br />Güvenebileceğiniz kalite.</p>
        <div class="footer-contact">
          <div>📞 XX XXX XX XX</div>
          <div>✉️ xx@gmail.com</div>
        </div>
      </div>
      <div class="footer-col">
        <h4>Hizmetler</h4>
        <a href="/order-form.html">Yeminli Çeviri</a>
        <a href="/order-form.html">Standart Çeviri</a>
        <a href="/fiyatlandirma.html">Fiyatlandırma</a>
      </div>
      <div class="footer-col">
        <h4>Çözümler</h4>
        <a href="/dile-gore.html">Dile Göre</a>
        <a href="/belgeye-gore.html">Belgeye Göre</a>
        <a href="/kullanim-alanina-gore.html">Kullanım Alanına Göre</a>
      </div>
      <div class="footer-col">
        <h4>Kurumsal</h4>
        <a href="/hakkimizda.html">Hakkımızda</a>
        <a href="/iletisim.html">İletişim</a>
        <a href="/referanslar.html">Referanslar</a>
      </div>
      <div class="footer-col">
        <h4>Kaynaklar</h4>
        <a href="/yardim-merkezi.html">Yardım Merkezi</a>
        <a href="/siparis-sorgulama.html">Sipariş Sorgulama</a>
      </div>
    </div>
    <div class="footer-bottom">
      <div class="footer-legal">
        <a href="/sartlar.html">Şartlar</a>
        <a href="/iade.html">İade</a>
        <a href="/gizlilik.html">Gizlilik</a>
        <a href="/guvenlik.html">Güvenlik</a>
      </div>
      <div class="footer-copy">© 2026 Mühür</div>
    </div>
  </footer>
</body>
</html>
```

- [ ] **Step 2: Create `public/quote-rejected.html`**

Identical to `quote-accepted.html` except the `<title>`, `order-wrap` section, replaced with:

```html
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mühür — Teklif Reddedildi</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <div class="site-nav">
    <div class="brand"><h3>Mühür</h3></div>
  </div>
  <div class="order-wrap">
    <h2 class="page-title">Teşekkürler</h2>
    <p class="page-sub">Geri bildiriminiz için teşekkürler.</p>
    <div class="card">
      <p style="color: var(--ink-2); font-size: 14px; line-height: 1.7; margin: 0;">Fikrinizi değiştirirseniz <a href="/order-form.html" style="color: var(--accent);">sipariş formu</a> üzerinden bize tekrar ulaşabilirsiniz.</p>
    </div>
  </div>
  <footer class="site-footer">
    <div class="footer-grid">
      <div class="footer-brand">
        <h3>Mühür</h3>
        <p>Hızlı ve güvenilir yeminli çeviri hizmeti.<br />Güvenebileceğiniz kalite.</p>
        <div class="footer-contact">
          <div>📞 XX XXX XX XX</div>
          <div>✉️ xx@gmail.com</div>
        </div>
      </div>
      <div class="footer-col">
        <h4>Hizmetler</h4>
        <a href="/order-form.html">Yeminli Çeviri</a>
        <a href="/order-form.html">Standart Çeviri</a>
        <a href="/fiyatlandirma.html">Fiyatlandırma</a>
      </div>
      <div class="footer-col">
        <h4>Çözümler</h4>
        <a href="/dile-gore.html">Dile Göre</a>
        <a href="/belgeye-gore.html">Belgeye Göre</a>
        <a href="/kullanim-alanina-gore.html">Kullanım Alanına Göre</a>
      </div>
      <div class="footer-col">
        <h4>Kurumsal</h4>
        <a href="/hakkimizda.html">Hakkımızda</a>
        <a href="/iletisim.html">İletişim</a>
        <a href="/referanslar.html">Referanslar</a>
      </div>
      <div class="footer-col">
        <h4>Kaynaklar</h4>
        <a href="/yardim-merkezi.html">Yardım Merkezi</a>
        <a href="/siparis-sorgulama.html">Sipariş Sorgulama</a>
      </div>
    </div>
    <div class="footer-bottom">
      <div class="footer-legal">
        <a href="/sartlar.html">Şartlar</a>
        <a href="/iade.html">İade</a>
        <a href="/gizlilik.html">Gizlilik</a>
        <a href="/guvenlik.html">Güvenlik</a>
      </div>
      <div class="footer-copy">© 2026 Mühür</div>
    </div>
  </footer>
</body>
</html>
```

- [ ] **Step 3: Create `public/quote-invalid.html`**

```html
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mühür — Geçersiz Bağlantı</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <div class="site-nav">
    <div class="brand"><h3>Mühür</h3></div>
  </div>
  <div class="order-wrap">
    <h2 class="page-title">Bu bağlantı artık geçerli değil</h2>
    <p class="page-sub">Teklif zaten yanıtlanmış olabilir ya da bağlantının süresi geçmiş olabilir.</p>
    <div class="card">
      <p style="color: var(--ink-2); font-size: 14px; line-height: 1.7; margin: 0;">Sorularınız için <a href="/order-form.html" style="color: var(--accent);">sipariş formu</a> üzerinden bize ulaşabilirsiniz.</p>
    </div>
  </div>
  <footer class="site-footer">
    <div class="footer-grid">
      <div class="footer-brand">
        <h3>Mühür</h3>
        <p>Hızlı ve güvenilir yeminli çeviri hizmeti.<br />Güvenebileceğiniz kalite.</p>
        <div class="footer-contact">
          <div>📞 XX XXX XX XX</div>
          <div>✉️ xx@gmail.com</div>
        </div>
      </div>
      <div class="footer-col">
        <h4>Hizmetler</h4>
        <a href="/order-form.html">Yeminli Çeviri</a>
        <a href="/order-form.html">Standart Çeviri</a>
        <a href="/fiyatlandirma.html">Fiyatlandırma</a>
      </div>
      <div class="footer-col">
        <h4>Çözümler</h4>
        <a href="/dile-gore.html">Dile Göre</a>
        <a href="/belgeye-gore.html">Belgeye Göre</a>
        <a href="/kullanim-alanina-gore.html">Kullanım Alanına Göre</a>
      </div>
      <div class="footer-col">
        <h4>Kurumsal</h4>
        <a href="/hakkimizda.html">Hakkımızda</a>
        <a href="/iletisim.html">İletişim</a>
        <a href="/referanslar.html">Referanslar</a>
      </div>
      <div class="footer-col">
        <h4>Kaynaklar</h4>
        <a href="/yardim-merkezi.html">Yardım Merkezi</a>
        <a href="/siparis-sorgulama.html">Sipariş Sorgulama</a>
      </div>
    </div>
    <div class="footer-bottom">
      <div class="footer-legal">
        <a href="/sartlar.html">Şartlar</a>
        <a href="/iade.html">İade</a>
        <a href="/gizlilik.html">Gizlilik</a>
        <a href="/guvenlik.html">Güvenlik</a>
      </div>
      <div class="footer-copy">© 2026 Mühür</div>
    </div>
  </footer>
</body>
</html>
```

- [ ] **Step 4: Verify manually**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR/muhur-backend"
docker compose up -d
npx dotenv -e .env -- npm run dev > /tmp/muhur-dev-server.log 2>&1 &
disown
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/quote-accepted.html
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/quote-rejected.html
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/quote-invalid.html
pkill -f "tsx watch src/server.ts"
```

Expected: `200` for all three.

- [ ] **Step 5: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/public/
git commit -m "feat: add quote accept/reject/invalid confirmation pages"
```

---

### Task 8: Manual End-to-End Verification

**Files:** none (verification only)

**Interfaces:**
- Consumes: the running dev server, real Postgres, every route/page from Tasks 1-7. Does not require real Twilio/Resend credentials — confirming the notification *attempt* happens and is logged (or that delivery errors are caught without breaking the customer-facing flow) is sufficient, matching the existing project convention that real third-party delivery is verified separately once real credentials are available.

- [ ] **Step 1: Start the stack**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR/muhur-backend"
docker compose up -d
npx dotenv -e .env -- npm run dev > /tmp/muhur-dev-server.log 2>&1 &
disown
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/health
```

Expected: `200`. If port 3000 is occupied by an unrelated app, use `PORT=4000` and substitute that port below.

- [ ] **Step 2: Create an order and confirm a notification attempt is logged**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR/muhur-backend"
curl -s -X POST http://localhost:3000/api/customers \
  -H "Content-Type: application/json" \
  -d '{"name": "Bildirim Test", "email": "bildirim-test@example.com"}'
```

Note the returned `customerId`, then:

```bash
curl -s -X POST http://localhost:3000/api/documents \
  -F "customerId=<customerId>" \
  -F "sourceLang=TR" \
  -F "targetLang=EN" \
  -F "pastedText=Bildirim testi için örnek metin."
```

Expected: `201` with `orderId`/`documentId`/`draftId`. Then:

```bash
grep -i "notification" /tmp/muhur-dev-server.log | tail -5
```

Expected: either no error line (if Twilio/Resend calls silently succeeded against fake dev credentials is unlikely — more likely) an error log line for the failed delivery attempt (`"Professional notification failed"`), which is the expected behavior without real credentials — confirms the code path ran without crashing the `201` response.

- [ ] **Step 3: Send a quote and follow the accept link in a real browser**

Log in via `mcp__Claude_Browser__*` tools (`/login.html`, `yagmur@muhur.com` / `changeme123`), open the order created in Step 2 at `/workspace.html?order=<orderId>`, enter a price in the "Fiyat Teklifi" card, click "Teklifi Gönder". Then:

```bash
grep -o "accept?token=[a-f0-9]*" /tmp/muhur-dev-server.log | tail -1
```

If the real Resend call succeeded, check the actual email instead (per the account/recipient set up in Faz 3). If it failed (expected without a real Resend key), the token can also be computed directly for verification purposes: skip to Step 4 using the order id and `QUOTE_TOKEN_SECRET` from `.env`.

- [ ] **Step 4: Verify the accept endpoint in a real browser**

Navigate (via `mcp__Claude_Browser__*` tools) to `http://localhost:3000/api/quotes/<orderId>/accept?token=<token>` (token from Step 3, or computed with `node -e "console.log(require('crypto').createHmac('sha256', '<QUOTE_TOKEN_SECRET from .env>').update('<orderId>:accept').digest('hex'))"`).

Confirm the browser lands on `/quote-accepted.html` with the confirmation message. Then reload `/workspace.html?order=<orderId>` (logged in as Yağmur) and confirm "Durum:" shows `APPROVED`.

- [ ] **Step 5: Verify the invalid-link case**

Navigate to the same URL again (`http://localhost:3000/api/quotes/<orderId>/accept?token=<token>`) — since the order is no longer `IN_REVIEW`, confirm this lands on `/quote-invalid.html` instead of re-approving.

- [ ] **Step 6: Regression check — run the automated backend suite**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR/muhur-backend"
npx dotenv -e .env.test -- npx vitest run
```

Expected: all tests pass, including every test added in Tasks 1-6.

- [ ] **Step 7: Clean up**

```bash
pkill -f "tsx watch src/server.ts"
```

- [ ] **Step 8: Record the verification**

If every step above passed with no code changes beyond Tasks 1-7, there's nothing further to commit — the browser walkthrough is the deliverable. If a bug was found and fixed during this task, commit it separately with a clear message, then re-run the affected steps.

---

## Tamamlanma Kriteri

Tüm görevler tamamlandığında: `npx dotenv -e .env.test -- npx vitest run` tüm testleri yeşil geçer, ve Task 8'deki manuel doğrulama yeni sipariş bildiriminin (e-posta+WhatsApp) tetiklendiğini, teklif e-postasındaki kabul linkinin siparişi `APPROVED`'a taşıdığını ve ikinci kez tıklanınca `quote-invalid.html`'e yönlendirdiğini kanıtlar. Gerçek Twilio/Resend teslimatı, kullanıcı gerçek kimlik bilgilerini `.env`'e girdikten sonra ayrı bir doğrulama adımı olarak ele alınacaktır (Faz 3 Task 4'teki Resend doğrulamasıyla aynı desen). Ödeme entegrasyonu bu planın kapsamı dışındadır.
