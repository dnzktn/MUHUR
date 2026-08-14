# Mühür Faz 3 — Real Email Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a professional send a finalized translation to the customer's real email address via Resend, from a new button in the existing workspace page — verified end-to-end against the real Resend API.

**Architecture:** An `EmailProvider` interface (mirroring Faz 1's `TranslationProvider`) abstracts the email call; `ResendEmailService` implements it with the real Resend SDK. `buildApp({ emailService? })` injects it, so route tests use a fake provider and never touch the real API. A new `POST /api/orders/:id/send-email` route requires a `FinalTranslation` to exist, sends its text as the email body, and marks `Order.status = "SENT"` on success.

**Tech Stack:** Same as Faz 1/2 (Fastify, Prisma, PostgreSQL, Vitest) plus the `resend` npm package. No frontend framework changes — same vanilla HTML/CSS/JS approach.

## Global Constraints

- `EmailProvider`/`ResendEmailService` follow the exact shape of Faz 1's `TranslationProvider`/`GeminiService` (`src/services/gemini.service.ts`) — an interface with one method, a class implementing it, injected via `BuildAppOptions`.
- The Resend sender address is fixed to `"onboarding@resend.dev"` (no verified custom domain yet) — do not parameterize or make this configurable, it's a known, documented limitation.
- Email content is the final translation's plain text (`FinalTranslation.finalText`) in the email body — no PDF generation, no attachments.
- No schema changes — `OrderStatus.SENT` already exists in `prisma/schema.prisma` from Faz 1, unused until now. Do not add a `DELIVERED` flow or any webhook endpoint — out of scope.
- Sending must be blocked with `400` if the order's document has no `FinalTranslation` yet. Resending after a successful send must be allowed (no blocking, no idempotency check) — this is a deliberate difference from `PATCH /api/orders/:id/finalize`'s `409` behavior in Faz 1/2.
- New backend endpoints must reuse Faz 1/2's existing patterns exactly: `requireAuth` preHandler, tenant-scoped Prisma queries via `request.professional!.tenantId`, `resetDb()` from `test/helpers/reset-db.ts` for test isolation.
- Never build HTML via string concatenation/`innerHTML` with user- or AI-supplied text — always `textContent` or `document.createElement` + `.textContent` (same rule as Faz 2).
- No automated frontend tests. The final task's verification is real commands against the real Resend API, not a unit test file.
- Postgres runs via Docker on host port `5433`; Prisma is pinned to `6.19.3`; run tests with `npx dotenv -e .env.test -- npx vitest run`; run the dev server with `npx dotenv -e .env -- npm run dev`. Vitest 4.1.10 rejects arrow functions passed to `vi.fn().mockImplementation()` used as a constructor — use a regular `function` expression (same issue Faz 1's Gemini service test hit). These are all unchanged from Faz 1 — see `docs/superpowers/plans/2026-08-05-backend-faz1-plan.md`'s Environment Notes if anything here fails.
- `RESEND_API_KEY` goes in `.env` only — `.env.test` never needs a real value since tests inject a fake `EmailProvider`.
- Out of scope for this plan: email intake (inbox monitoring), payment integration, the real prototype visual design, Resend domain verification, delivery-confirmation webhooks, PDF generation.

---

## File Structure

```
muhur-backend/
  src/
    services/
      email.service.ts       # new: EmailProvider interface + ResendEmailService
    routes/
      orders.routes.ts       # modified: add POST /api/orders/:id/send-email, accept opts.emailService
    app.ts                   # modified: construct/inject emailService
  test/
    services/
      email.test.ts          # new
    routes/
      orders.test.ts         # modified: add describe block for the new route
  public/
    workspace.html            # modified: add "E-posta ile Gönder" button
    workspace.js               # modified: show/hide the button by order status, wire its click handler
```

---

### Task 1: `EmailProvider` Interface + `ResendEmailService`

**Files:**
- Create: `muhur-backend/src/services/email.service.ts`
- Test: `muhur-backend/test/services/email.test.ts`

**Interfaces:**
- Produces: `SendEmailInput` (`{ to: string; subject: string; text: string }`), `EmailProvider` interface (`send(input: SendEmailInput): Promise<void>`), `ResendEmailService implements EmailProvider` — Task 2 imports `EmailProvider` for `BuildAppOptions` and the route's injected type, and `ResendEmailService` for `app.ts`'s default construction.

- [ ] **Step 1: Install the Resend SDK**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR/muhur-backend"
npm install resend
```

- [ ] **Step 2: Write the failing test**

`test/services/email.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.fn();

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send: sendMock } };
  }),
}));

import { ResendEmailService } from "../../src/services/email.service";

describe("ResendEmailService", () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it("sends an email with the fixed sender address", async () => {
    sendMock.mockResolvedValue({ data: { id: "email-123" }, error: null });

    const service = new ResendEmailService("fake-key");
    await service.send({
      to: "musteri@example.com",
      subject: "Çeviri Belgeniz Hazır",
      text: "Merhaba, çeviriniz hazır.",
    });

    expect(sendMock).toHaveBeenCalledWith({
      from: "onboarding@resend.dev",
      to: "musteri@example.com",
      subject: "Çeviri Belgeniz Hazır",
      text: "Merhaba, çeviriniz hazır.",
    });
  });

  it("throws with the Resend error message when the API returns an error", async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { message: "domain is not verified" },
    });

    const service = new ResendEmailService("fake-key");
    await expect(
      service.send({
        to: "musteri@example.com",
        subject: "Test",
        text: "Test",
      })
    ).rejects.toThrow("domain is not verified");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run test/services/email.test.ts`
Expected: FAIL — `Cannot find module '../../src/services/email.service'`

- [ ] **Step 4: Write `src/services/email.service.ts`**

```typescript
import { Resend } from "resend";

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
}

export interface EmailProvider {
  send(input: SendEmailInput): Promise<void>;
}

const FROM_ADDRESS = "onboarding@resend.dev";

export class ResendEmailService implements EmailProvider {
  private client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async send(input: SendEmailInput): Promise<void> {
    const result = await this.client.emails.send({
      from: FROM_ADDRESS,
      to: input.to,
      subject: input.subject,
      text: input.text,
    });

    if (result.error) {
      throw new Error(result.error.message);
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run test/services/email.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: add Resend email service with mockable provider interface"
```

---

### Task 2: `POST /api/orders/:id/send-email`

**Files:**
- Modify: `muhur-backend/src/routes/orders.routes.ts`
- Modify: `muhur-backend/src/app.ts`
- Modify: `muhur-backend/test/routes/orders.test.ts`

**Interfaces:**
- Consumes: `EmailProvider`/`ResendEmailService` (Task 1), `requireAuth`, the existing `seedOrderWithDraft()` test helper (returns `{ order, professional }`).
- Produces: `POST /api/orders/:id/send-email` → `200 { status: "SENT" }` on success. `buildApp(options: { geminiService?; emailService? })` — the `emailService` override lets this task's own tests (and any later task) avoid the real Resend API.

- [ ] **Step 1: Add the failing test**

Add these imports at the top of `test/routes/orders.test.ts` (alongside the existing ones):

```typescript
import { vi } from "vitest";
import type { EmailProvider } from "../../src/services/email.service";
```

Append this `describe` block to the end of the file:

```typescript
describe("POST /api/orders/:id/send-email", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function fakeEmailProvider(overrides: Partial<EmailProvider> = {}): EmailProvider {
    return {
      send: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  it("rejects requests without a token", async () => {
    const { order } = await seedOrderWithDraft();
    const app = buildApp({ emailService: fakeEmailProvider() });
    const res = await app.inject({
      method: "POST",
      url: `/api/orders/${order.id}/send-email`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("sends the final translation by email and marks the order SENT", async () => {
    const { order, professional } = await seedOrderWithDraft();
    const document = await prisma.document.findFirstOrThrow({ where: { orderId: order.id } });
    await prisma.finalTranslation.create({
      data: { documentId: document.id, editedById: professional.id, finalText: "Hello world, final." },
    });
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: order.customerId } });
    const token = signAuthToken({
      professionalId: professional.id,
      email: professional.email,
      tenantId: professional.tenantId,
    });
    const emailService = fakeEmailProvider();
    const app = buildApp({ emailService });

    const res = await app.inject({
      method: "POST",
      url: `/api/orders/${order.id}/send-email`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(emailService.send).toHaveBeenCalledWith({
      to: customer.email,
      subject: "Çeviri Belgeniz Hazır",
      text: "Hello world, final.",
    });

    const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(updatedOrder?.status).toBe("SENT");
  });

  it("returns 400 when the order has no final translation yet", async () => {
    const { order, professional } = await seedOrderWithDraft();
    const token = signAuthToken({
      professionalId: professional.id,
      email: professional.email,
      tenantId: professional.tenantId,
    });
    const app = buildApp({ emailService: fakeEmailProvider() });

    const res = await app.inject({
      method: "POST",
      url: `/api/orders/${order.id}/send-email`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeTruthy();
  });

  it("returns 404 when the order belongs to a different tenant", async () => {
    const { order: orderInTenantB } = await seedOrderWithDraft();
    const { professional: professionalInTenantA } = await seedOrderWithDraft();
    const token = signAuthToken({
      professionalId: professionalInTenantA.id,
      email: professionalInTenantA.email,
      tenantId: professionalInTenantA.tenantId,
    });
    const app = buildApp({ emailService: fakeEmailProvider() });

    const res = await app.inject({
      method: "POST",
      url: `/api/orders/${orderInTenantB.id}/send-email`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 502 and leaves the order status unchanged when the email provider fails", async () => {
    const { order, professional } = await seedOrderWithDraft();
    const document = await prisma.document.findFirstOrThrow({ where: { orderId: order.id } });
    await prisma.finalTranslation.create({
      data: { documentId: document.id, editedById: professional.id, finalText: "Hello world, final." },
    });
    const token = signAuthToken({
      professionalId: professional.id,
      email: professional.email,
      tenantId: professional.tenantId,
    });
    const emailService = fakeEmailProvider({
      send: vi.fn().mockRejectedValue(new Error("Resend API error")),
    });
    const app = buildApp({ emailService });

    const res = await app.inject({
      method: "POST",
      url: `/api/orders/${order.id}/send-email`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(502);

    const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(updatedOrder?.status).toBe(order.status);
  });

  it("allows sending twice — resending is not blocked", async () => {
    const { order, professional } = await seedOrderWithDraft();
    const document = await prisma.document.findFirstOrThrow({ where: { orderId: order.id } });
    await prisma.finalTranslation.create({
      data: { documentId: document.id, editedById: professional.id, finalText: "Hello world, final." },
    });
    const token = signAuthToken({
      professionalId: professional.id,
      email: professional.email,
      tenantId: professional.tenantId,
    });
    const emailService = fakeEmailProvider();
    const app = buildApp({ emailService });

    const firstRes = await app.inject({
      method: "POST",
      url: `/api/orders/${order.id}/send-email`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(firstRes.statusCode).toBe(200);

    const secondRes = await app.inject({
      method: "POST",
      url: `/api/orders/${order.id}/send-email`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(secondRes.statusCode).toBe(200);
    expect(emailService.send).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run test/routes/orders.test.ts`
Expected: FAIL — the 6 new tests get 404/connection errors, everything else in the file still passes; `buildApp({ emailService })` doesn't accept the option yet either, so this may also fail to compile until Step 4 is done — that's expected, both Step 3 and Step 4 must land together before re-running.

- [ ] **Step 3: Add the route to `src/routes/orders.routes.ts`**

Add the `EmailProvider` type import at the top:

```typescript
import type { EmailProvider } from "../services/email.service";
```

Change the function signature to accept options (currently `ordersRoutes(app: FastifyInstance): Promise<void>`):

```typescript
interface OrdersRoutesOptions {
  emailService: EmailProvider;
}

export async function ordersRoutes(app: FastifyInstance, opts: OrdersRoutesOptions): Promise<void> {
```

Append this route at the end of `ordersRoutes`, after the existing `app.patch("/api/orders/:id/finalize", ...)` block:

```typescript
  app.post(
    "/api/orders/:id/send-email",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const professional = request.professional!;

      const order = await prisma.order.findFirst({
        where: { id, tenantId: professional.tenantId },
        include: {
          customer: true,
          documents: { include: { finalTranslation: true } },
        },
      });
      if (!order) {
        return reply.code(404).send({ error: "Order not found" });
      }

      const finalTranslation = order.documents
        .map((doc) => doc.finalTranslation)
        .find((translation) => translation !== null);

      if (!finalTranslation) {
        return reply.code(400).send({ error: "Order has no final translation yet" });
      }

      try {
        await opts.emailService.send({
          to: order.customer.email,
          subject: "Çeviri Belgeniz Hazır",
          text: finalTranslation.finalText,
        });
      } catch (err) {
        request.log.error(err, "Email send failed");
        return reply.code(502).send({ error: "E-posta gönderilemedi, tekrar deneyin" });
      }

      await prisma.order.update({ where: { id }, data: { status: "SENT" } });

      return reply.send({ status: "SENT" });
    }
  );
```

- [ ] **Step 4: Wire `emailService` into `src/app.ts`**

Add the import:

```typescript
import { EmailProvider, ResendEmailService } from "./services/email.service";
```

Update `BuildAppOptions`:

```typescript
export interface BuildAppOptions {
  geminiService?: TranslationProvider;
  emailService?: EmailProvider;
}
```

Inside `buildApp`, add the default construction (alongside the existing `geminiService` line):

```typescript
  const emailService = options.emailService ?? new ResendEmailService(process.env.RESEND_API_KEY ?? "");
```

Update the `ordersRoutes` registration to pass it:

```typescript
  app.register(ordersRoutes, { emailService });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run test/routes/orders.test.ts`
Expected: PASS (all tests in the file, including the 6 new ones)

- [ ] **Step 6: Run the full suite to check for regressions**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: add POST /api/orders/:id/send-email route"
```

---

### Task 3: Workspace Page — "E-posta ile Gönder" Button

**Files:**
- Modify: `muhur-backend/public/workspace.html`
- Modify: `muhur-backend/public/workspace.js`

**Interfaces:**
- Consumes: `POST /api/orders/:id/send-email` (Task 2) → `200 { status: "SENT" }` on success, or `{ error }` on failure. Uses `orderId`, `token`, `showError`, `hideError`, `successEl` already defined in `workspace.js` from Faz 2.

- [ ] **Step 1: Add the button to `public/workspace.html`**

In the file, find this line (inside the second `workspace-columns` child div):

```html
          <button id="finalize-btn" type="button">Onayla</button>
```

Add a new button immediately after it:

```html
          <button id="finalize-btn" type="button">Onayla</button>
          <button id="send-email-btn" type="button" class="hidden">E-posta ile Gönder</button>
```

- [ ] **Step 2: Show the button when the order is already approved, in `loadOrder()`**

In `public/workspace.js`, find this line inside `loadOrder()`:

```javascript
    document.getElementById("order-status").textContent = order.status;
```

Add immediately after it:

```javascript
    const sendEmailBtn = document.getElementById("send-email-btn");
    if (order.status === "APPROVED" || order.status === "SENT") {
      sendEmailBtn.classList.remove("hidden");
    }
```

- [ ] **Step 3: Reveal the button right after a successful finalize**

Find this block inside the `finalize-btn` click handler:

```javascript
    successEl.textContent = "Onaylandı. E-posta gönderimi Faz 3'te eklenecek.";
    successEl.classList.remove("hidden");
    document.getElementById("finalize-btn").disabled = true;
```

Replace it with:

```javascript
    successEl.textContent = "Onaylandı.";
    successEl.classList.remove("hidden");
    document.getElementById("finalize-btn").disabled = true;
    document.getElementById("send-email-btn").classList.remove("hidden");
```

- [ ] **Step 4: Add the send-email click handler**

Append this to the end of `public/workspace.js` (after the existing `finalize-btn` click handler block):

```javascript
document.getElementById("send-email-btn").addEventListener("click", async () => {
  hideError();

  try {
    const res = await fetch(`/api/orders/${orderId}/send-email`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401) {
      localStorage.removeItem("muhur_token");
      window.location.href = "/login.html";
      return;
    }

    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || "E-posta gönderilemedi.");
    }

    document.getElementById("order-status").textContent = "SENT";
    successEl.textContent = "E-posta gönderildi.";
    successEl.classList.remove("hidden");
  } catch (err) {
    showError(err.message);
  }
});
```

Note: no `innerHTML` used anywhere in this addition — `successEl.textContent` and `document.getElementById("order-status").textContent` are both plain string assignments, consistent with the project's XSS-avoidance rule.

- [ ] **Step 5: Verify manually**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR/muhur-backend"
docker compose up -d
npx dotenv -e .env -- npm run dev > /tmp/muhur-dev-server.log 2>&1 &
disown
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/workspace.html
pkill -f "tsx watch src/server.ts"
```

Expected: `200`. Full functional verification (button appears after finalize, click actually sends a real email) happens in Task 4.

- [ ] **Step 6: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: add send-email button to workspace page"
```

---

### Task 4: Manual Verification Against the Real Resend API

**Files:** none (verification only)

**Interfaces:**
- Consumes: the running dev server, real Postgres, a real `RESEND_API_KEY` in `.env`, and a customer email address registered to that Resend account (Resend's `onboarding@resend.dev` sender can only deliver to the account owner's verified email while no custom domain is verified — see the design spec).

This task proves a real email is actually dispatched by Resend, not just that our code calls a mock correctly. A `200` from `POST /api/orders/:id/send-email` is real proof: `ResendEmailService.send()` throws (and the route returns `502`) on any Resend API error — including "recipient not allowed," "invalid API key," or "domain not verified." A `200` therefore means Resend genuinely accepted and queued the email.

- [ ] **Step 1: Ensure a real `RESEND_API_KEY` is set**

Confirm `.env`'s `RESEND_API_KEY` is a real key from a Resend account (resend.com → API Keys). Also confirm which email address is verified/allowed as a recipient for that account (Resend shows this during onboarding — typically the account owner's own signup email, since no custom domain is verified yet).

- [ ] **Step 2: Start the stack**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR/muhur-backend"
docker compose up -d
npx dotenv -e .env -- npm run prisma:seed
npx dotenv -e .env -- npm run dev > /tmp/muhur-dev-server.log 2>&1 &
disown
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/health
```

Expected: `200`

- [ ] **Step 3: Create and finalize a real order via curl, using the allowed recipient email**

Replace `YOUR_VERIFIED_EMAIL` below with the real address confirmed in Step 1:

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR/muhur-backend"

CUSTOMER_ID=$(curl -s -X POST http://localhost:3000/api/customers \
  -H "Content-Type: application/json" \
  -d '{"name": "Faz3 Test", "email": "YOUR_VERIFIED_EMAIL"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['customerId'])")
echo "Customer id: $CUSTOMER_ID"

DOCUMENT_RESPONSE=$(curl -s -X POST http://localhost:3000/api/documents \
  -F "customerId=$CUSTOMER_ID" \
  -F "sourceLang=TR" \
  -F "targetLang=EN" \
  -F "pastedText=Bu belge bir test çevirisidir. Faz 3 e-posta doğrulaması.")
echo "$DOCUMENT_RESPONSE"

ORDER_ID=$(echo "$DOCUMENT_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['orderId'])")
DOCUMENT_ID=$(echo "$DOCUMENT_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['documentId'])")
echo "Order id: $ORDER_ID / Document id: $DOCUMENT_ID"

TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "yagmur@muhur.com", "password": "changeme123"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

curl -s -X PATCH "http://localhost:3000/api/orders/$ORDER_ID/finalize" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"documentId\": \"$DOCUMENT_ID\", \"finalText\": \"This document is a test translation. Faz 3 email verification.\"}"
```

Expected: the `/api/documents` call returns `201` with a non-empty `draftId` (real Gemini call, per Faz 1's Task 12), and the `finalize` call returns `201` with a `FinalTranslation` object.

- [ ] **Step 4: Send the real email**

```bash
curl -i -s -X POST "http://localhost:3000/api/orders/$ORDER_ID/send-email" \
  -H "Authorization: Bearer $TOKEN"
```

Expected: `HTTP/1.1 200 OK` and body `{"status":"SENT"}`. If this returns `502`, check `/tmp/muhur-dev-server.log` for the actual Resend error (e.g. wrong API key, or the recipient isn't the account's verified address) before retrying.

- [ ] **Step 5: Confirm the order status persisted**

```bash
curl -s "http://localhost:3000/api/orders/$ORDER_ID" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])"
```

Expected: `SENT`

- [ ] **Step 6: Confirm the button appears in a real browser**

Use the `mcp__Claude_Browser__*` tools: navigate to `http://localhost:3000/login.html`, log in as `yagmur@muhur.com` / `changeme123`, then navigate directly to `http://localhost:3000/workspace.html?order=$ORDER_ID` (substitute the real order id). Confirm with `get_page_text` or a screenshot that:
- "Durum:" shows `SENT`
- The "E-posta ile Gönder" button is visible (not hidden) and clickable
- Clicking it again succeeds (`200`, resend allowed) and shows "E-posta gönderildi."

- [ ] **Step 7: Check the actual inbox**

Check the inbox for the `YOUR_VERIFIED_EMAIL` address used in Step 3 — confirm a real email arrived with subject "Çeviri Belgeniz Hazır" and body "This document is a test translation. Faz 3 email verification." This is the final, human-observable proof.

- [ ] **Step 8: Clean up**

```bash
pkill -f "tsx watch src/server.ts"
```

- [ ] **Step 9: Record the verification**

If every step above passed with no code changes, there's nothing to commit — the verification itself is the deliverable. If a bug was found and fixed during this task, commit it separately with a clear message describing the bug, then re-run the affected steps.

---

## Faz 3 (E-posta Gönderimi) Tamamlanma Kriteri

Tüm görevler tamamlandığında: `npx dotenv -e .env.test -- npx vitest run` tüm testleri yeşil geçer, ve Task 4'teki manuel doğrulama gerçek bir e-postanın gerçek bir gelen kutusuna ulaştığını kanıtlar. Bu noktada Faz 3'ün diğer alt projeleri (e-posta ile belge alımı, ödeme entegrasyonu, gerçek prototip tasarımı) ayrı spec+plan döngüleri olarak ele alınabilir.
