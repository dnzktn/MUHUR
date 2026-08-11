# Mühür Faz 2 — Order Form + Workspace UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two new backend endpoints and a minimal vanilla-JS frontend (served statically by Fastify) so a real user can, in a browser: submit a document for translation, log in, see their order list, and work through the AI draft in a workspace page — all against the real Faz 1 API.

**Architecture:** `@fastify/static` serves `muhur-backend/public/` at the site root. Two new backend routes (`POST /api/customers`, `GET /api/orders`) follow the exact patterns Faz 1 already established (tenant-scoped Prisma queries, `requireAuth`, `resetDb()` test helper). Frontend pages are plain HTML files each paired with one `<script>` file that calls the JSON API with `fetch`; a JWT from login is stored in `localStorage` and sent as `Authorization: Bearer <token>`.

**Tech Stack:** Same as Faz 1 (Fastify, Prisma, PostgreSQL, Vitest) plus `@fastify/static`. Frontend: plain HTML/CSS/vanilla JS, no build step, no framework.

## Global Constraints

- No build tool for the frontend — plain `.html`/`.css`/`.js` files served as-is.
- New backend endpoints must reuse Faz 1's existing patterns exactly: `requireAuth` preHandler for protected routes, `prisma.order.findMany({ where: { tenantId: request.professional!.tenantId } })`-style tenant scoping, `resetDb()` from `test/helpers/reset-db.ts` for test isolation, and `signAuthToken({ professionalId, email, tenantId })` (three fields — `tenantId` is required, added in Faz 1's final review fix).
- Never build HTML via string concatenation/`innerHTML` with user- or AI-supplied text (customer names, draft text, suggestions) — always set it via `textContent` or `document.createElement` + `.textContent`, to avoid stored XSS. This applies to every frontend task below; each task's code already follows this rule — do not "simplify" it back to `innerHTML` during implementation.
- No automated frontend tests. Each frontend task's verification step is a real command (`curl`) or, for the final task, a real browser walkthrough — not a unit test file.
- Postgres runs via Docker on host port `5433` (see `docker-compose.yml`); Prisma is pinned to `6.19.3`; run tests with `npx dotenv -e .env.test -- npx vitest run`; run the dev server with `npx dotenv -e .env -- npm run dev`. These are unchanged from Faz 1 — see `docs/superpowers/plans/2026-08-05-backend-faz1-plan.md`'s Environment Notes if any of this fails.
- Out of scope for this plan: marketing pages (home, services, pricing, corporate, tracking, contact), real email delivery, email intake, payment processing, the eventual real prototype visual design.

---

## File Structure

```
muhur-backend/
  src/
    routes/
      customers.routes.ts       # new: POST /api/customers
      orders.routes.ts          # modified: add GET /api/orders (list)
    app.ts                      # modified: register @fastify/static, customersRoutes
  test/
    routes/
      customers.test.ts         # new
      orders.test.ts            # modified: add GET /api/orders describe block
    static.test.ts              # new: proves static file serving is wired up
  public/
    styles.css                  # new: shared minimal styles for all pages
    order-form.html              # new: public order intake page
    order-form.js
    login.html                  # new: professional login
    login.js
    orders.html                  # new: order list (post-login landing page)
    orders.js
    workspace.html               # new: the translation workspace
    workspace.js
```

---

### Task 1: `POST /api/customers`

**Files:**
- Create: `muhur-backend/src/routes/customers.routes.ts`
- Modify: `muhur-backend/src/app.ts`
- Test: `muhur-backend/test/routes/customers.test.ts`

**Interfaces:**
- Consumes: `prisma` (`src/prisma.ts`).
- Produces: `customersRoutes(app: FastifyInstance): Promise<void>`, registered in `buildApp()`. Task 4's `order-form.js` calls `POST /api/customers` and expects `{ customerId: string }` on success.

- [ ] **Step 1: Write the failing test**

`test/routes/customers.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../../src/app";
import { prisma } from "../../src/prisma";
import { resetDb } from "../helpers/reset-db";

describe("POST /api/customers", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.tenant.create({ data: { name: "Mühür" } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a new customer and returns its id", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/customers",
      payload: { name: "Ayşe Yılmaz", email: "ayse@example.com" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.customerId).toBeTypeOf("string");

    const customer = await prisma.customer.findUnique({ where: { id: body.customerId } });
    expect(customer?.name).toBe("Ayşe Yılmaz");
    expect(customer?.email).toBe("ayse@example.com");
  });

  it("upserts by email — a second call with the same email returns the same id and updates the name", async () => {
    const app = buildApp();
    const first = await app.inject({
      method: "POST",
      url: "/api/customers",
      payload: { name: "Ayşe Yılmaz", email: "ayse@example.com" },
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/customers",
      payload: { name: "Ayşe Y.", email: "ayse@example.com" },
    });

    expect(second.statusCode).toBe(201);
    expect(first.json().customerId).toBe(second.json().customerId);

    const customer = await prisma.customer.findUnique({ where: { id: first.json().customerId } });
    expect(customer?.name).toBe("Ayşe Y.");
  });

  it("returns 400 when email is missing", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/customers",
      payload: { name: "Ayşe Yılmaz" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeTruthy();
  });

  it("returns 400 when name is missing", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/customers",
      payload: { email: "ayse@example.com" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run test/routes/customers.test.ts`
Expected: FAIL — `Cannot find module '../../src/routes/customers.routes'`

- [ ] **Step 3: Write `src/routes/customers.routes.ts`**

```typescript
import { FastifyInstance } from "fastify";
import { prisma } from "../prisma";

interface CreateCustomerBody {
  name?: unknown;
  email?: unknown;
}

export async function customersRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: CreateCustomerBody }>("/api/customers", async (request, reply) => {
    const { name, email } = request.body ?? {};

    if (typeof name !== "string" || name.trim().length === 0) {
      return reply.code(400).send({ error: "name is required" });
    }
    if (typeof email !== "string" || email.trim().length === 0) {
      return reply.code(400).send({ error: "email is required" });
    }

    const tenant = await prisma.tenant.findFirstOrThrow();

    const customer = await prisma.customer.upsert({
      where: { email },
      update: { name },
      create: { tenantId: tenant.id, name, email },
    });

    return reply.code(201).send({ customerId: customer.id });
  });
}
```

- [ ] **Step 4: Register the route in `src/app.ts`**

Add the import near the other route imports:

```typescript
import { customersRoutes } from "./routes/customers.routes";
```

Add the registration alongside the others:

```typescript
  app.register(authRoutes);
  app.register(customersRoutes);
  app.register(documentsRoutes, { geminiService });
  app.register(ordersRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run test/routes/customers.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: add POST /api/customers endpoint"
```

---

### Task 2: `GET /api/orders` (list)

**Files:**
- Modify: `muhur-backend/src/routes/orders.routes.ts`
- Modify: `muhur-backend/test/routes/orders.test.ts`

**Interfaces:**
- Consumes: `prisma`, `requireAuth`, the existing `seedOrderWithDraft()` test helper already defined at the top of `test/routes/orders.test.ts` (returns `{ order, professional }` where `professional.tenantId` is available).
- Produces: `GET /api/orders` → `200 [{ id, status, createdAt, customer: { name, email } }, ...]`, newest first, scoped to the caller's tenant. Task 6's `orders.js` calls this and expects this exact array shape.

- [ ] **Step 1: Add the failing test**

Add this `describe` block to the end of `test/routes/orders.test.ts` (the file already imports everything needed — `buildApp`, `prisma`, `hashPassword`, `signAuthToken`, `resetDb`, and defines `seedOrderWithDraft()` at the top; reuse it, do not redefine it):

```typescript
describe("GET /api/orders", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects requests without a token", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/api/orders" });
    expect(res.statusCode).toBe(401);
  });

  it("returns only orders belonging to the professional's tenant, newest first", async () => {
    const { order: orderInTenantA, professional } = await seedOrderWithDraft();
    const { order: orderInTenantB } = await seedOrderWithDraft();
    const token = signAuthToken({
      professionalId: professional.id,
      email: professional.email,
      tenantId: professional.tenantId,
    });
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/orders",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(orderInTenantA.id);
    expect(body[0].customer.name).toBe("Demo Müşteri");
    expect(body.some((order: { id: string }) => order.id === orderInTenantB.id)).toBe(false);
  });

  it("returns an empty array when the tenant has no orders", async () => {
    const tenant = await prisma.tenant.create({ data: { name: "Boş Tenant" } });
    const professional = await prisma.verifiedProfessional.create({
      data: {
        tenantId: tenant.id,
        name: "Yağmur",
        email: "yagmur-empty@muhur.com",
        passwordHash: await hashPassword("changeme123"),
        languages: ["TR", "EN"],
      },
    });
    const token = signAuthToken({
      professionalId: professional.id,
      email: professional.email,
      tenantId: professional.tenantId,
    });
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/orders",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run test/routes/orders.test.ts`
Expected: FAIL — the three new tests get 404 (route doesn't exist), everything else in the file still passes

- [ ] **Step 3: Add the route to `src/routes/orders.routes.ts`**

Add this as the first route inside `ordersRoutes` (before the existing `app.get("/api/orders/:id", ...)` block — order doesn't functionally matter since Fastify matches `/api/orders` and `/api/orders/:id` independently, but keep the list route first for readability):

```typescript
  app.get("/api/orders", { preHandler: requireAuth }, async (request, reply) => {
    const tenantId = request.professional!.tenantId;

    const orders = await prisma.order.findMany({
      where: { tenantId },
      include: { customer: true },
      orderBy: { createdAt: "desc" },
    });

    return reply.send(
      orders.map((order) => ({
        id: order.id,
        status: order.status,
        createdAt: order.createdAt,
        customer: { name: order.customer.name, email: order.customer.email },
      }))
    );
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run test/routes/orders.test.ts`
Expected: PASS (all tests in the file, including the 3 new ones)

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: add GET /api/orders list endpoint"
```

---

### Task 3: Static File Serving + Shared Styles

**Files:**
- Create: `muhur-backend/public/styles.css`
- Modify: `muhur-backend/src/app.ts`
- Test: `muhur-backend/test/static.test.ts`

**Interfaces:**
- Produces: every file under `muhur-backend/public/` served at the matching URL path (e.g. `public/order-form.html` → `GET /order-form.html`). Tasks 4-8 rely on this.
- Produces: `public/styles.css` with the class names `.page`, `.hidden`, `.error`, plus table and workspace-specific classes — Tasks 4, 5, 6, 7 reference these exact class names in their HTML.

- [ ] **Step 1: Install `@fastify/static`**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR/muhur-backend"
npm install @fastify/static
```

- [ ] **Step 2: Write `public/styles.css`**

```css
* {
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  margin: 0;
  background: #f5f5f7;
  color: #1d1d1f;
}

.page {
  max-width: 720px;
  margin: 40px auto;
  padding: 24px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

h1 {
  font-size: 20px;
  margin-top: 0;
}

h2 {
  font-size: 15px;
  margin-bottom: 8px;
}

label {
  display: block;
  margin-bottom: 16px;
  font-size: 14px;
  font-weight: 600;
}

input,
select,
textarea {
  display: block;
  width: 100%;
  margin-top: 6px;
  padding: 8px 10px;
  border: 1px solid #d2d2d7;
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
}

button {
  background: #0071e3;
  color: #fff;
  border: none;
  padding: 10px 20px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  margin-top: 8px;
  margin-right: 8px;
}

button:hover {
  background: #0077ed;
}

button:disabled {
  background: #a1a1a6;
  cursor: not-allowed;
}

.hidden {
  display: none;
}

.error {
  color: #d70015;
  margin-top: 12px;
  font-size: 14px;
}

#result,
#success {
  margin-top: 12px;
  font-size: 14px;
  color: #1a7f37;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 16px;
}

th,
td {
  text-align: left;
  padding: 8px;
  border-bottom: 1px solid #e5e5e7;
  font-size: 14px;
}

tr[data-order-id] {
  cursor: pointer;
}

tr[data-order-id]:hover {
  background: #f5f5f7;
}

.workspace-columns {
  display: flex;
  gap: 16px;
  margin-top: 16px;
}

.workspace-columns > div {
  flex: 1;
}

.editable {
  border: 1px solid #d2d2d7;
  border-radius: 6px;
  padding: 12px;
  min-height: 200px;
  white-space: pre-wrap;
  font-size: 14px;
}

.suggestions {
  list-style: none;
  padding: 0;
  border: 1px solid #d2d2d7;
  border-radius: 6px;
  margin-top: 8px;
}

.suggestions li {
  cursor: pointer;
  padding: 8px;
  font-size: 14px;
  border-bottom: 1px solid #e5e5e7;
}

.suggestions li:last-child {
  border-bottom: none;
}

.suggestions li:hover {
  background: #f5f5f7;
}
```

- [ ] **Step 3: Write the failing test**

`test/static.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildApp } from "../src/app";

describe("static file serving", () => {
  it("serves public/styles.css", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/styles.css" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/css");
    expect(res.body).toContain(".page");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run test/static.test.ts`
Expected: FAIL — 404, static plugin not registered yet

- [ ] **Step 5: Register `@fastify/static` in `src/app.ts`**

Add these imports at the top:

```typescript
import staticPlugin from "@fastify/static";
import path from "node:path";
```

Add the registration right after `app.register(multipart);`:

```typescript
  app.register(staticPlugin, {
    root: path.join(__dirname, "..", "public"),
  });
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run test/static.test.ts`
Expected: PASS

- [ ] **Step 7: Run the full suite to check for regressions**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run`
Expected: All tests PASS (confirms the static catch-all route doesn't shadow any `/api/*` route)

- [ ] **Step 8: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: serve public/ as static files, add shared styles"
```

---

### Task 4: Order Form Page

**Files:**
- Create: `muhur-backend/public/order-form.html`
- Create: `muhur-backend/public/order-form.js`

**Interfaces:**
- Consumes: `POST /api/customers` (Task 1) → `{ customerId }`; `POST /api/documents` (existing Faz 1 route, multipart: `customerId`, `sourceLang`, `targetLang`, `file` or `pastedText`) → `{ orderId, documentId, draftId }`.
- Consumes: `public/styles.css` classes `.page`, `.hidden`, `.error`, `#result` (Task 3).

- [ ] **Step 1: Write `public/order-form.html`**

```html
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mühür — Sipariş Formu</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <main class="page">
    <h1>Çeviri Siparişi</h1>
    <form id="order-form">
      <label>
        Ad Soyad
        <input type="text" id="name" required />
      </label>
      <label>
        E-posta
        <input type="email" id="email" required />
      </label>
      <label>
        Kaynak Dil
        <select id="sourceLang">
          <option value="TR">Türkçe</option>
          <option value="EN">İngilizce</option>
          <option value="FR">Fransızca</option>
        </select>
      </label>
      <label>
        Hedef Dil
        <select id="targetLang">
          <option value="EN">İngilizce</option>
          <option value="TR">Türkçe</option>
          <option value="FR">Fransızca</option>
        </select>
      </label>
      <label>
        Belge Dosyası (PDF, JPG, PNG, DOCX)
        <input type="file" id="file" accept=".pdf,.jpg,.jpeg,.png,.docx" />
      </label>
      <label>
        veya Metni Yapıştırın
        <textarea id="pastedText" rows="6"></textarea>
      </label>
      <button type="submit">Siparişi Gönder</button>
    </form>
    <div id="result" class="hidden"></div>
    <div id="error" class="error hidden"></div>
  </main>
  <script src="/order-form.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `public/order-form.js`**

```javascript
document.getElementById("order-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const errorBox = document.getElementById("error");
  const resultBox = document.getElementById("result");
  errorBox.classList.add("hidden");
  resultBox.classList.add("hidden");

  const name = document.getElementById("name").value.trim();
  const email = document.getElementById("email").value.trim();
  const sourceLang = document.getElementById("sourceLang").value;
  const targetLang = document.getElementById("targetLang").value;
  const file = document.getElementById("file").files[0];
  const pastedText = document.getElementById("pastedText").value.trim();

  if (!file && !pastedText) {
    errorBox.textContent = "Bir dosya yükleyin veya metin yapıştırın.";
    errorBox.classList.remove("hidden");
    return;
  }

  try {
    const customerRes = await fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email }),
    });
    const customerBody = await customerRes.json();
    if (!customerRes.ok) {
      throw new Error(customerBody.error || "Müşteri oluşturulamadı.");
    }

    const form = new FormData();
    form.append("customerId", customerBody.customerId);
    form.append("sourceLang", sourceLang);
    form.append("targetLang", targetLang);
    if (file) {
      form.append("file", file);
    } else {
      form.append("pastedText", pastedText);
    }

    const documentRes = await fetch("/api/documents", {
      method: "POST",
      body: form,
    });
    const documentBody = await documentRes.json();
    if (!documentRes.ok) {
      throw new Error(documentBody.error || "Belge yüklenemedi.");
    }

    resultBox.textContent = `Siparişiniz alındı. Takip numaranız: ${documentBody.orderId}`;
    resultBox.classList.remove("hidden");
    document.getElementById("order-form").reset();
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.remove("hidden");
  }
});
```

- [ ] **Step 3: Verify the page is served**

Run: `cd muhur-backend && npx dotenv -e .env.test -- npx vitest run test/static.test.ts` (confirms the static plugin still serves `public/` correctly after adding new files)
Expected: PASS

Then start the dev server and check manually:

```bash
docker compose up -d
npx dotenv -e .env -- npm run dev &
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/order-form.html
```

Expected: `200`

- [ ] **Step 4: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: add public order form page"
```

---

### Task 5: Login Page

**Files:**
- Create: `muhur-backend/public/login.html`
- Create: `muhur-backend/public/login.js`

**Interfaces:**
- Consumes: `POST /api/auth/login` (existing Faz 1 route) → `{ token }` on success.
- Produces: on success, writes the JWT to `localStorage.setItem("muhur_token", token)` and redirects to `/orders.html`. Tasks 6, 7, 8 read `localStorage.getItem("muhur_token")` under this exact key.

- [ ] **Step 1: Write `public/login.html`**

```html
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mühür — Giriş</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <main class="page">
    <h1>Profesyonel Girişi</h1>
    <form id="login-form">
      <label>
        E-posta
        <input type="email" id="email" required />
      </label>
      <label>
        Şifre
        <input type="password" id="password" required />
      </label>
      <button type="submit">Giriş Yap</button>
    </form>
    <div id="error" class="error hidden"></div>
  </main>
  <script src="/login.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `public/login.js`**

```javascript
document.getElementById("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const errorBox = document.getElementById("error");
  errorBox.classList.add("hidden");

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || "Giriş başarısız.");
    }

    localStorage.setItem("muhur_token", body.token);
    window.location.href = "/orders.html";
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.remove("hidden");
  }
});
```

- [ ] **Step 3: Verify the page is served**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/login.html
```

Expected: `200` (dev server from Task 4 should still be running; if not, restart it as in Task 4 Step 3)

- [ ] **Step 4: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: add professional login page"
```

---

### Task 6: Order List Page

**Files:**
- Create: `muhur-backend/public/orders.html`
- Create: `muhur-backend/public/orders.js`

**Interfaces:**
- Consumes: `GET /api/orders` (Task 2) → `[{ id, status, createdAt, customer: { name, email } }, ...]`. Consumes `localStorage.getItem("muhur_token")` (Task 5).
- Produces: clicking a row navigates to `/workspace.html?order=<id>` — Task 7 reads this exact query parameter name (`order`).

- [ ] **Step 1: Write `public/orders.html`**

```html
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mühür — Siparişler</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <main class="page">
    <h1>Siparişler</h1>
    <table id="orders-table">
      <thead>
        <tr>
          <th>Müşteri</th>
          <th>Durum</th>
          <th>Tarih</th>
        </tr>
      </thead>
      <tbody id="orders-body"></tbody>
    </table>
    <div id="error" class="error hidden"></div>
  </main>
  <script src="/orders.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `public/orders.js`**

```javascript
const token = localStorage.getItem("muhur_token");
if (!token) {
  window.location.href = "/login.html";
}

async function loadOrders() {
  const errorBox = document.getElementById("error");
  errorBox.classList.add("hidden");

  try {
    const res = await fetch("/api/orders", {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401) {
      localStorage.removeItem("muhur_token");
      window.location.href = "/login.html";
      return;
    }

    const orders = await res.json();
    if (!res.ok) {
      throw new Error(orders.error || "Siparişler yüklenemedi.");
    }

    const tbody = document.getElementById("orders-body");
    tbody.innerHTML = "";

    for (const order of orders) {
      const row = document.createElement("tr");
      row.dataset.orderId = order.id;

      const nameCell = document.createElement("td");
      nameCell.textContent = order.customer.name;

      const statusCell = document.createElement("td");
      statusCell.textContent = order.status;

      const dateCell = document.createElement("td");
      dateCell.textContent = new Date(order.createdAt).toLocaleString("tr-TR");

      row.append(nameCell, statusCell, dateCell);
      row.addEventListener("click", () => {
        window.location.href = `/workspace.html?order=${order.id}`;
      });
      tbody.appendChild(row);
    }
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.remove("hidden");
  }
}

loadOrders();
```

Note: `tbody.innerHTML = ""` only clears content (safe, empty string) — every row cell is built with `document.createElement` + `.textContent`, never `innerHTML` with order data, per the Global Constraints XSS rule.

- [ ] **Step 3: Verify manually**

Since this page requires a valid token and at least one order, defer full verification to Task 9's browser walkthrough. For now, just confirm the static file serves:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/orders.html
```

Expected: `200`

- [ ] **Step 4: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: add order list page"
```

---

### Task 7: Workspace Page — Load and Display

**Files:**
- Create: `muhur-backend/public/workspace.html`
- Create: `muhur-backend/public/workspace.js`

**Interfaces:**
- Consumes: `GET /api/orders/:id` (existing Faz 1 route) → the order with `documents[].extractedText`, `documents[].drafts[].draftText`/`.status`, `documents[].finalTranslation.finalText`. Reads `order` query param (Task 6) and `localStorage.getItem("muhur_token")` (Task 5).
- Produces: module-level `let currentDocumentId` (set once the order loads) and `let orderId`, `let token` — Task 8 appends more code to the same `workspace.js` file and uses these exact variable names.

- [ ] **Step 1: Write `public/workspace.html`**

```html
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mühür — Çalışma Alanı</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <main class="page">
    <h1>Çalışma Alanı</h1>
    <div id="loading">Yükleniyor...</div>
    <div id="workspace-content" class="hidden">
      <p><strong>Müşteri:</strong> <span id="customer-name"></span></p>
      <p><strong>Durum:</strong> <span id="order-status"></span></p>
      <div class="workspace-columns">
        <div>
          <h2>Orijinal Metin</h2>
          <div id="original-text" class="editable"></div>
        </div>
        <div>
          <h2>Nihai Çeviri (düzenlenebilir)</h2>
          <div id="final-text" class="editable" contenteditable="true"></div>
          <button id="suggest-btn" type="button">Seçili Metin İçin Öneri İste</button>
          <ul id="suggestions" class="suggestions hidden"></ul>
          <button id="add-signature-btn" type="button">İmza/Tarih Ekle</button>
          <button id="finalize-btn" type="button">Onayla</button>
        </div>
      </div>
    </div>
    <div id="error" class="error hidden"></div>
    <div id="success" class="hidden"></div>
  </main>
  <script src="/workspace.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `public/workspace.js`**

```javascript
const token = localStorage.getItem("muhur_token");
if (!token) {
  window.location.href = "/login.html";
}

const params = new URLSearchParams(window.location.search);
const orderId = params.get("order");

const loadingEl = document.getElementById("loading");
const contentEl = document.getElementById("workspace-content");
const errorEl = document.getElementById("error");
const successEl = document.getElementById("success");

let currentDocumentId = null;

function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
}

async function loadOrder() {
  if (!orderId) {
    showError("Sipariş ID'si belirtilmedi.");
    loadingEl.classList.add("hidden");
    return;
  }

  try {
    const res = await fetch(`/api/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401) {
      localStorage.removeItem("muhur_token");
      window.location.href = "/login.html";
      return;
    }

    const order = await res.json();
    if (!res.ok) {
      throw new Error(order.error || "Sipariş yüklenemedi.");
    }

    const doc = order.documents[0];
    if (!doc) {
      throw new Error("Bu siparişte belge bulunamadı.");
    }
    currentDocumentId = doc.id;

    document.getElementById("customer-name").textContent = order.customer.name;
    document.getElementById("order-status").textContent = order.status;
    document.getElementById("original-text").textContent =
      doc.extractedText || "(orijinal metin yok)";

    const readyDraft = doc.drafts.find((draft) => draft.status === "READY");
    const finalTextEl = document.getElementById("final-text");
    if (doc.finalTranslation) {
      finalTextEl.textContent = doc.finalTranslation.finalText;
    } else if (readyDraft) {
      finalTextEl.textContent = readyDraft.draftText;
    } else {
      finalTextEl.textContent = "(AI taslağı henüz hazır değil)";
    }

    loadingEl.classList.add("hidden");
    contentEl.classList.remove("hidden");
  } catch (err) {
    loadingEl.classList.add("hidden");
    showError(err.message);
  }
}

loadOrder();
```

Note the local variable is named `doc`, not `document` — shadowing the global `document` object would break every `document.getElementById` call below it in the same scope.

- [ ] **Step 3: Verify manually**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/workspace.html
```

Expected: `200`. Full functional verification (real order, real draft) happens in Task 9.

- [ ] **Step 4: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: add workspace page (load and display order)"
```

---

### Task 8: Workspace Page — Suggest, Signature, Finalize

**Files:**
- Modify: `muhur-backend/public/workspace.js`

**Interfaces:**
- Consumes: `POST /api/documents/:id/suggest` (existing Faz 1 route, JSON body `{ text, context }`) → `{ suggestions: string[] }`. Consumes `PATCH /api/orders/:id/finalize` (existing Faz 1 route, JSON body `{ documentId, finalText }`) → `201` on success, `409` if already finalized. Uses `currentDocumentId`, `orderId`, `token`, `showError` defined in Task 7's `workspace.js`.

- [ ] **Step 1: Append to `public/workspace.js`**

Add this to the end of the file (after the `loadOrder()` call at the bottom):

```javascript
document.getElementById("suggest-btn").addEventListener("click", async () => {
  const selection = window.getSelection();
  const selectedText = selection.toString().trim();

  if (!selectedText) {
    showError("Öneri istemek için önce metin seçin.");
    return;
  }

  const finalTextEl = document.getElementById("final-text");
  const context = finalTextEl.textContent;

  try {
    const res = await fetch(`/api/documents/${currentDocumentId}/suggest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text: selectedText, context }),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || "Öneri alınamadı.");
    }

    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const suggestionsEl = document.getElementById("suggestions");
    suggestionsEl.innerHTML = "";

    for (const suggestion of body.suggestions) {
      const item = document.createElement("li");
      item.textContent = suggestion;
      item.addEventListener("click", () => {
        if (range) {
          range.deleteContents();
          range.insertNode(document.createTextNode(suggestion));
        }
        suggestionsEl.classList.add("hidden");
      });
      suggestionsEl.appendChild(item);
    }
    suggestionsEl.classList.remove("hidden");
  } catch (err) {
    showError(err.message);
  }
});

document.getElementById("add-signature-btn").addEventListener("click", () => {
  const finalTextEl = document.getElementById("final-text");
  const signatureLine = document.createTextNode(
    `\n\nOnaylayan: Yağmur — Tarih: ${new Date().toLocaleDateString("tr-TR")}`
  );
  finalTextEl.appendChild(signatureLine);
});

document.getElementById("finalize-btn").addEventListener("click", async () => {
  if (!currentDocumentId) {
    return;
  }

  const finalTextEl = document.getElementById("final-text");
  const finalText = finalTextEl.textContent.trim();

  try {
    const res = await fetch(`/api/orders/${orderId}/finalize`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ documentId: currentDocumentId, finalText }),
    });
    const body = await res.json();

    if (res.status === 409) {
      showError("Bu belge zaten onaylanmış.");
      return;
    }
    if (!res.ok) {
      throw new Error(body.error || "Onaylama başarısız.");
    }

    successEl.textContent = "Onaylandı. E-posta gönderimi Faz 3'te eklenecek.";
    successEl.classList.remove("hidden");
    document.getElementById("finalize-btn").disabled = true;
  } catch (err) {
    showError(err.message);
  }
});
```

Note: `suggestionsEl.innerHTML = ""` only clears content (safe); each suggestion `<li>` is built with `document.createElement` + `.textContent`, never raw HTML — same XSS rule as Task 6.

- [ ] **Step 2: Verify manually**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/workspace.html
```

Expected: `200` (page still loads; button click behavior is verified end-to-end in Task 9).

- [ ] **Step 3: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: add suggest, signature, and finalize actions to workspace page"
```

---

### Task 9: Manual End-to-End Browser Verification

**Files:** none (verification only)

**Interfaces:**
- Consumes: the full stack running locally (dev server, real Postgres, real Gemini API) and every page from Tasks 4-8.

This task proves the whole Faz 2 flow works for a real user in a real browser: submit an order, log in, see it in the list, work through the AI draft, and finalize it. Use the `mcp__Claude_Browser__*` tools (`preview_start`, `navigate`, `computer`, `read_page`, `get_page_text`) to drive an actual browser — this is not a curl-only check.

- [ ] **Step 1: Ensure the stack is running with a real Gemini key**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR/muhur-backend"
docker compose up -d
npx dotenv -e .env -- npm run prisma:seed
```

Confirm `.env`'s `GEMINI_API_KEY` is set to a real, working key (per `docs/superpowers/plans/2026-08-05-backend-faz1-plan.md`'s Environment Notes, the model is `gemini-flash-latest` — if this key is new, re-verify with `curl "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY"` that `gemini-flash-latest` is listed before proceeding).

Start the dev server in the background:

```bash
npx dotenv -e .env -- npm run dev > /tmp/muhur-dev-server.log 2>&1 &
disown
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/health
```

Expected: `200`

- [ ] **Step 2: Open the order form in the browser and submit a real order**

Use `mcp__Claude_Browser__preview_start` with `url: "http://localhost:3000/order-form.html"` (or `navigate` if a tab is already open). Fill in:
- Ad Soyad: `Test Müşteri`
- E-posta: `test-musteri@example.com`
- Kaynak Dil: `TR`, Hedef Dil: `EN` (defaults are fine)
- Metni Yapıştırın: `Bu belge nüfus cüzdanı örneğidir. Ad: Test Müşteri. Doğum tarihi: 01.01.1990.`

Click "Siparişi Gönder". Use `get_page_text` or `read_page` to confirm the `#result` div now shows "Siparişiniz alındı. Takip numaranız: ..." — take a screenshot to confirm visually. This is a real Gemini call; wait a few seconds if needed.

If it fails, check `/tmp/muhur-dev-server.log` for the actual backend error before retrying.

- [ ] **Step 3: Log in**

Navigate to `http://localhost:3000/login.html`. Fill in:
- E-posta: `yagmur@muhur.com`
- Şifre: `changeme123`

(This is the seeded professional from `prisma:seed`.) Click "Giriş Yap". Confirm the browser navigates to `/orders.html`.

- [ ] **Step 4: Confirm the order appears in the list**

On `/orders.html`, use `get_page_text` to confirm a row containing "Test Müşteri" is present. Take a screenshot.

- [ ] **Step 5: Open the workspace and verify the draft loaded**

Click the row for "Test Müşteri" (or navigate directly to `/workspace.html?order=<the orderId printed in Step 2>`). Confirm:
- "Orijinal Metin" shows the pasted Turkish text
- "Nihai Çeviri" shows a real English translation (not the placeholder text) — read it with `get_page_text` and confirm it's plausible English, not "(AI taslağı henüz hazır değil)"

Take a screenshot.

- [ ] **Step 6: Test the suggest interaction**

Select a word or short phrase inside the "Nihai Çeviri" box (use `computer` with a click-drag or double-click to select a word). Click "Seçili Metin İçin Öneri İste". Confirm the `#suggestions` list appears with 2-3 items (real Gemini call). Click one suggestion and confirm it replaces the selected text in place.

- [ ] **Step 7: Test signature and finalize**

Click "İmza/Tarih Ekle" — confirm a line like "Onaylayan: Yağmur — Tarih: ..." is appended to the final text. Click "Onayla". Confirm the `#success` box shows "Onaylandı. E-posta gönderimi Faz 3'te eklenecek." and the "Onayla" button becomes disabled.

- [ ] **Step 8: Confirm idempotency in the browser**

Reload the page (`navigate` to the same `workspace.html?order=...` URL again). Confirm the order status now shows `APPROVED` and the final text shown matches what was finalized (proves `GET /api/orders/:id` correctly returns the `finalTranslation` after the fact, per Task 7's `doc.finalTranslation` branch).

- [ ] **Step 9: Clean up**

```bash
pkill -f "tsx watch src/server.ts"
```

- [ ] **Step 10: Record the verification and commit if any fixes were needed**

If every step above passed with no code changes, there's nothing to commit — the browser walkthrough is the deliverable. If a bug was found and fixed during this task, commit it separately with a clear message describing the bug, then re-run the affected steps.

---

## Faz 2 Tamamlanma Kriteri

Tüm görevler tamamlandığında: `npx dotenv -e .env.test -- npx vitest run` tüm testleri yeşil geçer, ve Task 9'daki tarayıcı doğrulaması gerçek bir müşterinin sipariş verip, profesyonelin giriş yapıp, AI taslağını düzenleyip onaylayabildiğini kanıtlar. Bu noktada Faz 3 (e-posta alım/gönderim, ödeme, gerçek prototip tasarımı) ayrı bir spec+plan olarak ele alınabilir.
