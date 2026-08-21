# Mühür — Price Quote Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a professional enter a manual price for an order and send it to the customer as a standalone quote email (never the translation text), from a new "Fiyat Teklifi" card in the existing workspace page.

**Architecture:** A new `POST /api/orders/:id/send-quote` route follows the exact pattern of the existing `POST /api/orders/:id/send-email` route (JWT-protected, tenant-scoped, injected `EmailProvider`), but writes to `Order.priceTotal` (already in the schema, unused until now) instead of requiring a `FinalTranslation`, and moves `Order.status` to `IN_REVIEW` (already in the schema, unused until now) instead of `SENT`. No schema changes. The workspace frontend gets a new price-input + button card, using the same `fetch`/error-handling idioms already established in `workspace.js`.

**Tech Stack:** Same as the rest of the project (Fastify, Prisma, PostgreSQL, Vitest, vanilla JS, no build step).

## Global Constraints

- No schema/migration changes — `Order.priceTotal` (`Float`, default `0`) and `OrderStatus.IN_REVIEW` already exist in `prisma/schema.prisma` and are simply used for the first time.
- The quote email must never include the translation text — only the price and a short note.
- Sending must be blocked with `400` if `priceTotal` is missing, not a number, or `<= 0`. Resending (to update the price) must be allowed — no `409`/idempotency blocking, matching `send-email`'s "resend allowed" behavior, not `finalize`'s.
- Tenant-scoped lookup via `request.professional!.tenantId`, matching every other route in `orders.routes.ts`.
- On email-provider failure, `Order.priceTotal`/`status` must remain unchanged (matching `send-email`'s failure behavior) — never a half-applied update.
- Never build HTML via string concatenation/`innerHTML` with dynamic content — use `textContent`/`document.createElement`, matching the rest of `workspace.js`.
- No automated frontend tests — the final task is a real browser walkthrough using the `mcp__Claude_Browser__*` tools, matching every prior frontend task in this project.
- Postgres runs via Docker on host port `5433`; Prisma is pinned to `6.19.3`; run tests with `npx dotenv -e .env.test -- npx vitest run` from `muhur-backend/`; run the dev server with `npx dotenv -e .env -- npm run dev`. If port 3000 is occupied by an unrelated app on this machine (a known issue on this dev machine — an unrelated Next.js/Clerk project sometimes grabs it), run the dev server with `PORT=4000` (or any free port) instead — do not kill processes you don't recognize.
- Out of scope: payment integration, a formal "quote accepted" state/flow (still manual/off-system for now), quote history/versioning (only the latest sent price is kept, overwriting `Order.priceTotal`), marketing/pricing pages.

---

## File Structure

```
muhur-backend/
  src/
    routes/
      orders.routes.ts       # modified: add POST /api/orders/:id/send-quote
  test/
    routes/
      orders.test.ts         # modified: add describe block for the new route
  public/
    styles.css                # modified: style the new number input + quote card
    workspace.html             # modified: add the "Fiyat Teklifi" card
    workspace.js                # modified: populate/send the price on load and on click
```

---

### Task 1: `POST /api/orders/:id/send-quote`

**Files:**
- Modify: `muhur-backend/src/routes/orders.routes.ts`
- Modify: `muhur-backend/test/routes/orders.test.ts`

**Interfaces:**
- Consumes: `EmailProvider` (already injected into `ordersRoutes` via `opts.emailService`), `requireAuth`, the existing `seedOrderWithDraft()` test helper (returns `{ order, professional }`).
- Produces: `POST /api/orders/:id/send-quote` → `200 { status: "IN_REVIEW", priceTotal: number }` on success. This is the last route in `orders.routes.ts`; nothing later in this plan depends on new exports beyond the route itself being registered.

- [ ] **Step 1: Add the failing test**

Append this `describe` block to the end of `test/routes/orders.test.ts` (the file already imports `EmailProvider`, `vi`, `buildApp`, `prisma`, `hashPassword`, `signAuthToken`, `resetDb`, and defines `seedOrderWithDraft()` at the top — reuse it, do not redefine it):

```typescript
describe("POST /api/orders/:id/send-quote", () => {
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
      url: `/api/orders/${order.id}/send-quote`,
      payload: { priceTotal: 360 },
    });
    expect(res.statusCode).toBe(401);
  });

  it("sends a quote email and updates priceTotal and status", async () => {
    const { order, professional } = await seedOrderWithDraft();
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
      url: `/api/orders/${order.id}/send-quote`,
      headers: { authorization: `Bearer ${token}` },
      payload: { priceTotal: 360 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "IN_REVIEW", priceTotal: 360 });
    expect(emailService.send).toHaveBeenCalledWith({
      to: customer.email,
      subject: "Çeviri Teklifiniz Hazır",
      text: expect.stringContaining("360"),
    });

    const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(updatedOrder?.priceTotal).toBe(360);
    expect(updatedOrder?.status).toBe("IN_REVIEW");
  });

  it("returns 400 when priceTotal is missing, zero, or negative", async () => {
    const { order, professional } = await seedOrderWithDraft();
    const token = signAuthToken({
      professionalId: professional.id,
      email: professional.email,
      tenantId: professional.tenantId,
    });
    const app = buildApp({ emailService: fakeEmailProvider() });

    const noBodyRes = await app.inject({
      method: "POST",
      url: `/api/orders/${order.id}/send-quote`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(noBodyRes.statusCode).toBe(400);

    const zeroRes = await app.inject({
      method: "POST",
      url: `/api/orders/${order.id}/send-quote`,
      headers: { authorization: `Bearer ${token}` },
      payload: { priceTotal: 0 },
    });
    expect(zeroRes.statusCode).toBe(400);

    const negativeRes = await app.inject({
      method: "POST",
      url: `/api/orders/${order.id}/send-quote`,
      headers: { authorization: `Bearer ${token}` },
      payload: { priceTotal: -50 },
    });
    expect(negativeRes.statusCode).toBe(400);
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
      url: `/api/orders/${orderInTenantB.id}/send-quote`,
      headers: { authorization: `Bearer ${token}` },
      payload: { priceTotal: 200 },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 502 and leaves priceTotal/status unchanged when the email provider fails", async () => {
    const { order, professional } = await seedOrderWithDraft();
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
      url: `/api/orders/${order.id}/send-quote`,
      headers: { authorization: `Bearer ${token}` },
      payload: { priceTotal: 360 },
    });

    expect(res.statusCode).toBe(502);

    const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(updatedOrder?.priceTotal).toBe(0);
    expect(updatedOrder?.status).toBe(order.status);
  });

  it("allows sending a quote twice — resending with an updated price is not blocked", async () => {
    const { order, professional } = await seedOrderWithDraft();
    const token = signAuthToken({
      professionalId: professional.id,
      email: professional.email,
      tenantId: professional.tenantId,
    });
    const emailService = fakeEmailProvider();
    const app = buildApp({ emailService });

    const firstRes = await app.inject({
      method: "POST",
      url: `/api/orders/${order.id}/send-quote`,
      headers: { authorization: `Bearer ${token}` },
      payload: { priceTotal: 360 },
    });
    expect(firstRes.statusCode).toBe(200);

    const secondRes = await app.inject({
      method: "POST",
      url: `/api/orders/${order.id}/send-quote`,
      headers: { authorization: `Bearer ${token}` },
      payload: { priceTotal: 420 },
    });
    expect(secondRes.statusCode).toBe(200);
    expect(emailService.send).toHaveBeenCalledTimes(2);

    const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(updatedOrder?.priceTotal).toBe(420);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run test/routes/orders.test.ts`
Expected: FAIL — the 6 new tests get 404/connection errors (route doesn't exist), everything else in the file still passes.

- [ ] **Step 3: Add the route to `src/routes/orders.routes.ts`**

Append this route at the end of `ordersRoutes`, after the existing `app.post("/api/orders/:id/send-email", ...)` block, right before the function's closing brace:

```typescript
  app.post(
    "/api/orders/:id/send-quote",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const professional = request.professional!;
      const body = request.body as { priceTotal?: unknown } | undefined;
      const priceTotal = body?.priceTotal;

      if (typeof priceTotal !== "number" || !Number.isFinite(priceTotal) || priceTotal <= 0) {
        return reply.code(400).send({ error: "priceTotal must be a positive number" });
      }

      const order = await prisma.order.findFirst({
        where: { id, tenantId: professional.tenantId },
        include: { customer: true },
      });
      if (!order) {
        return reply.code(404).send({ error: "Order not found" });
      }

      try {
        await opts.emailService.send({
          to: order.customer.email,
          subject: "Çeviri Teklifiniz Hazır",
          text: `Merhaba, çeviri talebiniz için fiyat teklifimiz: ${priceTotal} TL. Bu teklifi kabul etmek isterseniz bizimle iletişime geçebilirsiniz.`,
        });
      } catch (err) {
        request.log.error(err, "Quote email send failed");
        return reply.code(502).send({ error: "Teklif e-postası gönderilemedi, tekrar deneyin" });
      }

      await prisma.order.update({ where: { id }, data: { priceTotal, status: "IN_REVIEW" } });

      return reply.send({ status: "IN_REVIEW", priceTotal });
    }
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run test/routes/orders.test.ts`
Expected: PASS (all tests in the file, including the 6 new ones)

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: add POST /api/orders/:id/send-quote route"
```

---

### Task 2: Workspace "Fiyat Teklifi" Card

**Files:**
- Modify: `muhur-backend/public/styles.css`
- Modify: `muhur-backend/public/workspace.html`
- Modify: `muhur-backend/public/workspace.js`

**Interfaces:**
- Consumes: `POST /api/orders/:id/send-quote` (Task 1) → `200 { status, priceTotal }` on success, or `{ error }` on failure. Uses the existing `orderId`, `token`, `showError`, `hideError`, `successEl` module-level bindings already defined in `workspace.js`.

- [ ] **Step 1: Style the number input and the new card, in `public/styles.css`**

Find this rule (it currently styles text/email/password inputs, selects, and textareas):

```css
select, input[type=text], input[type=email], input[type=password], textarea {
```

Replace it with (adding `input[type=number]`):

```css
select, input[type=text], input[type=email], input[type=password], input[type=number], textarea {
```

Then add these two new rules right after the `.panel-actions` rule (search for `.panel-actions { display: flex; gap: 10px; }` — add the new rules immediately below it):

```css
.quote-title { font-size: 15px; margin-bottom: 12px; }
.quote-row-input { display: flex; gap: 10px; align-items: center; }
.quote-row-input input[type=number] { max-width: 160px; }
```

- [ ] **Step 2: Add the quote card to `public/workspace.html`**

Find this block:

```html
        <div class="send-box">
          <div class="panel-actions">
            <button class="btn accent" id="finalize-btn" type="button">Onayla</button>
            <button class="btn secondary hidden" id="send-email-btn" type="button">E-posta ile Gönder</button>
          </div>
        </div>
```

Insert a new `send-box` immediately before it (so the quote card appears above the Onayla/E-posta section):

```html
        <div class="send-box">
          <h3 class="quote-title">Fiyat Teklifi</h3>
          <div class="quote-row-input">
            <input type="number" id="price-input" min="0" step="0.01" placeholder="Örn. 360" />
            <button class="btn secondary" id="send-quote-btn" type="button">Teklifi Gönder</button>
          </div>
        </div>

        <div class="send-box">
          <div class="panel-actions">
            <button class="btn accent" id="finalize-btn" type="button">Onayla</button>
            <button class="btn secondary hidden" id="send-email-btn" type="button">E-posta ile Gönder</button>
          </div>
        </div>
```

- [ ] **Step 3: Pre-fill the price input on load, in `public/workspace.js`**

Find this line inside `loadOrder()`:

```javascript
    const sendEmailBtn = document.getElementById("send-email-btn");
    if (order.status === "APPROVED" || order.status === "SENT") {
      sendEmailBtn.classList.remove("hidden");
    }
```

Add immediately after it:

```javascript
    const priceInput = document.getElementById("price-input");
    if (order.priceTotal && order.priceTotal > 0) {
      priceInput.value = order.priceTotal;
    }
```

- [ ] **Step 4: Add the send-quote click handler**

Append this to the end of `public/workspace.js` (after the existing `send-email-btn` click handler block):

```javascript
document.getElementById("send-quote-btn").addEventListener("click", async () => {
  hideError();

  const priceInput = document.getElementById("price-input");
  const priceTotal = Number(priceInput.value);

  if (!priceInput.value || Number.isNaN(priceTotal) || priceTotal <= 0) {
    showError("Geçerli bir fiyat girin.");
    return;
  }

  try {
    const res = await fetch(`/api/orders/${orderId}/send-quote`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ priceTotal }),
    });

    if (res.status === 401) {
      localStorage.removeItem("muhur_token");
      window.location.href = "/login.html";
      return;
    }

    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || "Teklif gönderilemedi.");
    }

    document.getElementById("order-status").textContent = body.status;
    successEl.textContent = `Teklif gönderildi: ${body.priceTotal} TL`;
    successEl.classList.remove("hidden");
  } catch (err) {
    showError(err.message);
  }
});
```

Note: no `innerHTML` used anywhere in this addition — `successEl.textContent` and `document.getElementById("order-status").textContent` are plain string assignments, consistent with the project's XSS-avoidance rule.

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

Expected: `200`. If port 3000 is occupied by an unrelated app, retry with `PORT=4000` prepended to the `npx dotenv` command and check `http://localhost:4000/workspace.html` instead. Full functional verification happens in Task 3.

- [ ] **Step 6: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: add price quote card to workspace page"
```

---

### Task 3: Manual End-to-End Browser Verification

**Files:** none (verification only)

**Interfaces:**
- Consumes: the running dev server, real Postgres, and every page/route from Tasks 1-2. Does not require a real Resend API key — confirming the quote email *attempt* happens and status updates correctly (or that a clean `502` renders if the key is still a placeholder) is sufficient; real-inbox delivery is Faz 3 Task 4's separate, already-tracked responsibility.

- [ ] **Step 1: Start the stack**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR/muhur-backend"
docker compose up -d
npx dotenv -e .env -- npm run dev > /tmp/muhur-dev-server.log 2>&1 &
disown
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/health
```

Expected: `200`. If port 3000 is occupied by an unrelated app on this machine, use `PORT=4000` and substitute that port in every URL below — do not kill unrecognized processes.

- [ ] **Step 2: Log in and open an existing order's workspace**

Use the `mcp__Claude_Browser__*` tools: navigate to `/login.html`, log in as `yagmur@muhur.com` / `changeme123`, go to `/orders.html`, and open any order that has a ready draft (or create a fresh one via `/order-form.html` with pasted text first, if none exist).

- [ ] **Step 3: Verify the quote card renders and send a quote**

On the workspace page, confirm a "Fiyat Teklifi" card is visible above the "Onayla" section, with a number input and a "Teklifi Gönder" button. Enter `360` and click the button. Confirm one of:
- A success message like "Teklif gönderildi: 360 TL" appears and the "Durum:" badge updates to `IN_REVIEW` (if a working `EmailProvider`/Resend key is configured), or
- A clean `502` error message appears (if no real key is configured yet) — either outcome proves the frontend/route wiring is correct; only real delivery is out of scope here.

- [ ] **Step 4: Verify resubmission is allowed and pre-fills correctly**

Reload the workspace page for the same order. Confirm the price input is pre-filled with `360` (if Step 3 succeeded) or empty (if Step 3 hit the `502` case, since `priceTotal` was never persisted). If Step 3 succeeded, change the value to `420` and click "Teklifi Gönder" again — confirm it succeeds without any blocking error.

- [ ] **Step 5: Regression check — run the automated backend suite**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR/muhur-backend"
npx dotenv -e .env.test -- npx vitest run
```

Expected: all tests pass, including the 6 new `send-quote` tests from Task 1.

- [ ] **Step 6: Clean up**

```bash
pkill -f "tsx watch src/server.ts"
```

- [ ] **Step 7: Record the verification**

If every step above passed with no code changes beyond Tasks 1-2, there's nothing further to commit — the browser walkthrough is the deliverable. If a bug was found and fixed during this task, commit it separately with a clear message, then re-run the affected steps.

---

## Tamamlanma Kriteri

Tüm görevler tamamlandığında: `npx dotenv -e .env.test -- npx vitest run` tüm testleri yeşil geçer, ve Task 3'teki manuel doğrulama çalışma alanından gerçek bir fiyat teklifinin gönderilebildiğini (ya da anahtar yoksa temiz bir hata ile geri bildirim verildiğini) ve tekrar gönderimin engellenmediğini kanıtlar. Sitede hiçbir sabit fiyat gösterilmediği kararı kalıcıdır — ileride pazarlama sayfaları eklenirse bu spec'e referans verilmelidir.
