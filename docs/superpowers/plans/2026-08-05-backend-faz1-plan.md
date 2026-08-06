# Mühür Backend Faz 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a working Node.js/TypeScript backend for Mühür that stores orders/documents in Postgres, translates uploaded documents with Gemini, and exposes a JWT-protected workspace API — verified end-to-end with a real Gemini call.

**Architecture:** Fastify HTTP server + Prisma ORM + PostgreSQL (Docker). A `TranslationProvider` interface abstracts the AI call so `GeminiService` (real, calls `@google/generative-ai`) can be swapped for a test double in integration tests. Routes are thin: validate input, touch Prisma, call the injected provider, map errors to HTTP status codes.

**Tech Stack:** TypeScript, Fastify, `@fastify/multipart`, Prisma, PostgreSQL 16 (Docker), `@google/generative-ai`, `bcryptjs`, `jsonwebtoken`, `mammoth` (docx extraction), Vitest (tests), `docx` + `form-data` (test fixtures only).

## Global Constraints

- AI provider is **Gemini only** for this phase; no Claude integration. Code must not hardcode "gemini" where a second provider would later plug in — use the `TranslationProvider` interface and a `provider` string column on `Draft`.
- Development uses the **free Gemini tier** (AI Studio key). Do not add any code that assumes billing/Vertex AI. This is a data-privacy constraint or the operator's account, not something to test for.
- Environment is **local only** — Postgres runs via Docker Compose, no cloud deploy config in this phase.
- Terminology: use `VerifiedProfessional`, never `SwornTranslator`/`yeminli_tercuman`, in code, table names, or API fields.
- Multi-tenant fields (`tenantId`) must exist on every tenant-scoped model even though only one `Tenant` row exists in this phase. **Decided during Task 2 review:** `Draft`, `FinalTranslation`, and `Payment` intentionally do NOT carry their own `tenantId` — they're scoped via their `Document`/`Order` relation instead. This is accepted (YAGNI for single-tenant Faz 1), not an oversight.
- Email sending is out of scope — do not add SendGrid/Postmark calls.
- Payment processing is out of scope — the `Payment` table exists in schema only, no route touches it.
- Every route that can fail loudly must: never leave an `Order`/`Draft` silently stuck — always write a terminal status (`READY`/`FAILED`) so nothing hangs in an ambiguous state.

## Environment Notes (discovered during Task 2)

This machine's environment required three deviations from the exact values written into Task 2's steps below. Any task/operator re-running those steps verbatim should use these values instead:

- **Postgres host port is `5433`, not `5432`** (port 5432 was already in use by another container on this machine). `docker-compose.yml`, `.env`, `.env.example`, and `.env.test` all use `5433`.
- **Prisma is pinned to `6.19.3`**, not latest. Prisma 7 removed `datasource.url` support in `schema.prisma` in favor of `prisma.config.ts` + a driver adapter, which is incompatible with this plan's schema syntax. Install with `npm install @prisma/client@6.19.3` / `npm install -D prisma@6.19.3`.
- **`tsconfig.json`'s `moduleResolution` is `"bundler"`, not `"node"`.** TypeScript 7.0.2 (installed in Task 1) rejects `"node"` with `TS5108: Option 'moduleResolution=node10' has been removed`.

---

## File Structure

```
muhur-backend/
  package.json
  tsconfig.json
  vitest.config.ts
  docker-compose.yml
  .env.example
  .env                (gitignored, dev)
  .env.test            (gitignored, test)
  .gitignore
  prisma/
    schema.prisma
    seed.ts
  src/
    app.ts                       # buildApp(): FastifyInstance factory (used by server + tests)
    server.ts                    # entrypoint: buildApp().listen()
    prisma.ts                    # PrismaClient singleton
    lib/
      password.ts                # hashPassword / verifyPassword
      jwt.ts                     # signAuthToken / verifyAuthToken
      auth-guard.ts               # requireAuth Fastify preHandler
      errors.ts                  # Fastify error handler
    services/
      extraction.service.ts      # extractDocxText
      gemini.service.ts          # TranslationProvider interface + GeminiService
    routes/
      auth.routes.ts             # POST /api/auth/login
      documents.routes.ts        # POST /api/documents, POST /api/documents/:id/suggest
      orders.routes.ts           # GET /api/orders/:id, PATCH /api/orders/:id/finalize
  scripts/
    test-flow.ts                 # manual e2e script hitting real Gemini
  test/
    setup.ts                     # loads .env.test
    helpers/
      reset-db.ts                # truncates all tables between tests
    lib/
      password.test.ts
      jwt.test.ts
      auth-guard.test.ts
    services/
      extraction.test.ts
      gemini.test.ts
    routes/
      auth.test.ts
      documents.test.ts
      orders.test.ts
```

---

### Task 1: Project Scaffold & Health Check

**Files:**
- Create: `muhur-backend/package.json`
- Create: `muhur-backend/tsconfig.json`
- Create: `muhur-backend/vitest.config.ts`
- Create: `muhur-backend/.gitignore`
- Create: `muhur-backend/src/app.ts`
- Create: `muhur-backend/src/server.ts`
- Test: `muhur-backend/test/app.test.ts`

**Interfaces:**
- Produces: `buildApp(): FastifyInstance` from `src/app.ts`, used by every later task's tests and by `src/server.ts`.

- [ ] **Step 1: Create the project and install dependencies**

```bash
mkdir -p "/Users/denizokten/Desktop/VAULT/MUHUR/muhur-backend"
cd "/Users/denizokten/Desktop/VAULT/MUHUR/muhur-backend"
npm init -y
npm install fastify @fastify/multipart
npm install -D typescript tsx vitest @types/node
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src", "prisma", "scripts", "test"]
}
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
dist/
.env
.env.test
```

- [ ] **Step 4: Write `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    testTimeout: 15000,
  },
});
```

- [ ] **Step 5: Create `test/setup.ts` (empty for now, filled in Task 2)**

```typescript
import { config } from "dotenv";

config({ path: ".env.test" });
```

Run: `npm install -D dotenv` first.

- [ ] **Step 6: Write the failing test for `buildApp`**

`test/app.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildApp } from "../src/app";

describe("GET /health", () => {
  it("returns ok status", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run test/app.test.ts`
Expected: FAIL — `Cannot find module '../src/app'`

- [ ] **Step 8: Write `src/app.ts`**

```typescript
import Fastify, { FastifyInstance } from "fastify";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}
```

- [ ] **Step 9: Write `src/server.ts`**

```typescript
import { buildApp } from "./app";

const app = buildApp();
const port = Number(process.env.PORT ?? 3000);

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`Mühür backend listening on port ${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
```

- [ ] **Step 10: Add npm scripts to `package.json`**

Add to the `"scripts"` object:

```json
{
  "dev": "tsx watch src/server.ts",
  "build": "tsc",
  "start": "node dist/server.js",
  "test": "vitest run"
}
```

- [ ] **Step 11: Run test to verify it passes**

Run: `npx vitest run test/app.test.ts`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: scaffold Fastify project with health check"
```

---

### Task 2: Docker Postgres + Prisma Schema & Migration

**Files:**
- Create: `muhur-backend/docker-compose.yml`
- Create: `muhur-backend/.env.example`
- Create: `muhur-backend/.env`
- Create: `muhur-backend/.env.test`
- Create: `muhur-backend/prisma/schema.prisma`
- Create: `muhur-backend/src/prisma.ts`
- Modify: `muhur-backend/test/setup.ts` (already loads `.env.test`, no change needed)

**Interfaces:**
- Produces: `prisma` (PrismaClient singleton) from `src/prisma.ts`, used by every route and test after this task.
- Produces: Prisma models `Tenant`, `Customer`, `VerifiedProfessional`, `Document`, `Order`, `Draft`, `FinalTranslation`, `Payment` with the enums below — later tasks reference these exact names.

- [ ] **Step 1: Write `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: muhur_dev
    ports:
      - "5432:5432"
    volumes:
      - muhur_pgdata:/var/lib/postgresql/data

volumes:
  muhur_pgdata:
```

- [ ] **Step 2: Start Postgres and verify it's running**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR/muhur-backend"
docker compose up -d
docker compose ps
```

Expected: `postgres` service shows `running`/`healthy`.

- [ ] **Step 3: Create the test database**

```bash
docker compose exec postgres psql -U postgres -c "CREATE DATABASE muhur_test;"
```

Expected: `CREATE DATABASE`

- [ ] **Step 4: Write `.env.example`, `.env`, `.env.test`**

`.env.example`:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/muhur_dev"
JWT_SECRET="change-me-in-dev"
GEMINI_API_KEY="your-google-ai-studio-key"
PORT=3000
```

`.env` (copy of example, real values filled in by the operator later):

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/muhur_dev"
JWT_SECRET="dev-secret-change-me"
GEMINI_API_KEY=""
PORT=3000
```

`.env.test`:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/muhur_test"
JWT_SECRET="test-secret"
GEMINI_API_KEY="unused-in-tests"
```

- [ ] **Step 5: Install Prisma and initialize**

```bash
npm install @prisma/client
npm install -D prisma
```

- [ ] **Step 6: Write `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Tenant {
  id            String                 @id @default(uuid())
  name          String
  customers     Customer[]
  professionals VerifiedProfessional[]
  documents     Document[]
  orders        Order[]
  createdAt     DateTime               @default(now())
}

enum CustomerType {
  INDIVIDUAL
  CORPORATE
}

model Customer {
  id        String       @id @default(uuid())
  tenantId  String
  tenant    Tenant       @relation(fields: [tenantId], references: [id])
  name      String
  email     String       @unique
  phone     String?
  type      CustomerType @default(INDIVIDUAL)
  orders    Order[]
  documents Document[]
  createdAt DateTime     @default(now())
}

model VerifiedProfessional {
  id                String             @id @default(uuid())
  tenantId          String
  tenant            Tenant             @relation(fields: [tenantId], references: [id])
  name              String
  email             String             @unique
  passwordHash      String
  languages         String[]
  region            String?
  capacity          Int                @default(10)
  rate              Float?
  assignedOrders    Order[]
  finalTranslations FinalTranslation[]
  createdAt         DateTime           @default(now())
}

enum DocumentFormat {
  PDF
  IMAGE
  DOCX
  PASTED_TEXT
}

enum DocumentStatus {
  RECEIVED
  EXTRACTING
  READY
  FAILED
}

model Document {
  id               String            @id @default(uuid())
  tenantId         String
  tenant           Tenant            @relation(fields: [tenantId], references: [id])
  customerId       String
  customer         Customer          @relation(fields: [customerId], references: [id])
  orderId          String
  order            Order             @relation(fields: [orderId], references: [id])
  sourceFormat     DocumentFormat
  fileUrl          String?
  extractedText    String?
  sourceLang       String
  targetLang       String
  status           DocumentStatus    @default(RECEIVED)
  drafts           Draft[]
  finalTranslation FinalTranslation?
  createdAt        DateTime          @default(now())
}

enum OrderStatus {
  RECEIVED
  AI_DRAFTING
  DRAFTS_READY
  IN_REVIEW
  APPROVED
  SENT
  DELIVERED
}

enum ServiceType {
  STANDARD
  EXPRESS
}

model Order {
  id                     String                 @id @default(uuid())
  tenantId               String
  tenant                 Tenant                 @relation(fields: [tenantId], references: [id])
  customerId             String
  customer               Customer               @relation(fields: [customerId], references: [id])
  status                 OrderStatus            @default(RECEIVED)
  serviceType            ServiceType            @default(STANDARD)
  notary                 Boolean                @default(false)
  apostille              Boolean                @default(false)
  pageCount              Int                    @default(1)
  priceTotal             Float                  @default(0)
  assignedProfessionalId String?
  assignedProfessional   VerifiedProfessional?  @relation(fields: [assignedProfessionalId], references: [id])
  documents              Document[]
  payments               Payment[]
  createdAt              DateTime               @default(now())
}

enum DraftStatus {
  PENDING
  READY
  FAILED
}

model Draft {
  id         String      @id @default(uuid())
  documentId String
  document   Document    @relation(fields: [documentId], references: [id])
  provider   String
  draftText  String?
  status     DraftStatus @default(PENDING)
  createdAt  DateTime    @default(now())
}

model FinalTranslation {
  id         String               @id @default(uuid())
  documentId String               @unique
  document   Document             @relation(fields: [documentId], references: [id])
  editedById String
  editedBy   VerifiedProfessional @relation(fields: [editedById], references: [id])
  finalText  String
  signedAt   DateTime             @default(now())
}

enum PaymentMethod {
  CARD
  IBAN
}

enum PaymentStatus {
  PENDING
  PAID
  FAILED
}

model Payment {
  id        String        @id @default(uuid())
  orderId   String
  order     Order         @relation(fields: [orderId], references: [id])
  method    PaymentMethod
  status    PaymentStatus @default(PENDING)
  amount    Float
  createdAt DateTime      @default(now())
}
```

- [ ] **Step 7: Run the migration against the dev database**

```bash
npx dotenv -e .env -- npx prisma migrate dev --name init
```

If `dotenv-cli` isn't installed: `npm install -D dotenv-cli` first.

Expected: `Your database is now in sync with your schema.` and a new file under `prisma/migrations/`.

- [ ] **Step 8: Apply the same migration to the test database**

```bash
npx dotenv -e .env.test -- npx prisma migrate deploy
```

Expected: `All migrations have been successfully applied.`

- [ ] **Step 9: Write `src/prisma.ts`**

```typescript
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
```

- [ ] **Step 10: Verify Prisma Client generates and types check**

```bash
npx prisma generate
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 11: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: add Postgres via Docker and Prisma schema"
```

---

### Task 3: Password Hashing + JWT Library

**Files:**
- Create: `muhur-backend/src/lib/password.ts`
- Create: `muhur-backend/src/lib/jwt.ts`
- Test: `muhur-backend/test/lib/password.test.ts`
- Test: `muhur-backend/test/lib/jwt.test.ts`

**Interfaces:**
- Produces: `hashPassword(plain: string): Promise<string>`, `verifyPassword(plain: string, hash: string): Promise<boolean>` — used by Task 5 (login) and seed.
- Produces: `signAuthToken(payload: { professionalId: string; email: string }): string`, `verifyAuthToken(token: string): { professionalId: string; email: string }` — used by Task 4 (auth guard) and Task 5 (login route).

- [ ] **Step 1: Install dependencies**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR/muhur-backend"
npm install bcryptjs jsonwebtoken
npm install -D @types/bcryptjs @types/jsonwebtoken
```

- [ ] **Step 2: Write the failing test for password hashing**

`test/lib/password.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../../src/lib/password";

describe("password", () => {
  it("hashes and verifies a correct password", async () => {
    const hash = await hashPassword("correct-horse");
    expect(await verifyPassword("correct-horse", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct-horse");
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/lib/password.test.ts`
Expected: FAIL — `Cannot find module '../../src/lib/password'`

- [ ] **Step 4: Write `src/lib/password.ts`**

```typescript
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/lib/password.test.ts`
Expected: PASS

- [ ] **Step 6: Write the failing test for JWT**

`test/lib/jwt.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { signAuthToken, verifyAuthToken } from "../../src/lib/jwt";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
});

describe("jwt", () => {
  it("round-trips a valid payload", () => {
    const token = signAuthToken({ professionalId: "abc-123", email: "yagmur@muhur.com" });
    const payload = verifyAuthToken(token);
    expect(payload.professionalId).toBe("abc-123");
    expect(payload.email).toBe("yagmur@muhur.com");
  });

  it("throws on a tampered token", () => {
    const token = signAuthToken({ professionalId: "abc-123", email: "yagmur@muhur.com" });
    expect(() => verifyAuthToken(token + "tamper")).toThrow();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run test/lib/jwt.test.ts`
Expected: FAIL — `Cannot find module '../../src/lib/jwt'`

- [ ] **Step 8: Write `src/lib/jwt.ts`**

```typescript
import jwt from "jsonwebtoken";

export interface AuthTokenPayload {
  professionalId: string;
  email: string;
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set");
  }
  return secret;
}

export function signAuthToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: "8h" });
}

export function verifyAuthToken(token: string): AuthTokenPayload {
  return jwt.verify(token, getSecret()) as AuthTokenPayload;
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run test/lib/jwt.test.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: add password hashing and JWT helpers"
```

---

### Task 4: Auth Guard Middleware

**Files:**
- Create: `muhur-backend/src/lib/auth-guard.ts`
- Test: `muhur-backend/test/lib/auth-guard.test.ts`

**Interfaces:**
- Consumes: `verifyAuthToken` from `src/lib/jwt.ts` (Task 3).
- Produces: `requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void>` Fastify preHandler, and attaches `request.professional: { professionalId: string; email: string }` — used by Task 5, 8, 9, 10 routes.

- [ ] **Step 1: Write the failing test**

`test/lib/auth-guard.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import Fastify from "fastify";
import { requireAuth } from "../../src/lib/auth-guard";
import { signAuthToken } from "../../src/lib/jwt";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
});

function buildTestApp() {
  const app = Fastify();
  app.get("/protected", { preHandler: requireAuth }, async (request) => ({
    professional: (request as any).professional,
  }));
  return app;
}

describe("requireAuth", () => {
  it("rejects requests without a token", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/protected" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an invalid token", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("allows a valid token and attaches the professional payload", async () => {
    const app = buildTestApp();
    const token = signAuthToken({ professionalId: "abc-123", email: "yagmur@muhur.com" });
    const res = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().professional.professionalId).toBe("abc-123");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/auth-guard.test.ts`
Expected: FAIL — `Cannot find module '../../src/lib/auth-guard'`

- [ ] **Step 3: Write `src/lib/auth-guard.ts`**

```typescript
import { FastifyReply, FastifyRequest } from "fastify";
import { verifyAuthToken, AuthTokenPayload } from "./jwt";

declare module "fastify" {
  interface FastifyRequest {
    professional?: AuthTokenPayload;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Missing authorization token" });
    return;
  }

  const token = header.slice("Bearer ".length);
  try {
    request.professional = verifyAuthToken(token);
  } catch {
    reply.code(401).send({ error: "Invalid or expired token" });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/auth-guard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: add JWT auth guard middleware"
```

---

### Task 5: Seed Script + Login Route

**Files:**
- Create: `muhur-backend/prisma/seed.ts`
- Create: `muhur-backend/src/lib/errors.ts`
- Create: `muhur-backend/src/routes/auth.routes.ts`
- Create: `muhur-backend/test/helpers/reset-db.ts`
- Modify: `muhur-backend/src/app.ts`
- Test: `muhur-backend/test/routes/auth.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 2), `hashPassword`/`verifyPassword` (Task 3), `signAuthToken` (Task 3).
- Produces: `POST /api/auth/login` route, registered in `buildApp()`. `resetDb(): Promise<void>` helper — used by every route test from here on.

- [ ] **Step 1: Write `src/lib/errors.ts`**

```typescript
import { FastifyError, FastifyReply, FastifyRequest } from "fastify";

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  request.log.error(error);
  const statusCode = error.statusCode ?? 500;
  reply.code(statusCode).send({ error: statusCode === 500 ? "Internal server error" : error.message });
}
```

- [ ] **Step 2: Write `test/helpers/reset-db.ts`**

```typescript
import { prisma } from "../../src/prisma";

export async function resetDb(): Promise<void> {
  await prisma.finalTranslation.deleteMany();
  await prisma.draft.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.document.deleteMany();
  await prisma.order.deleteMany();
  await prisma.verifiedProfessional.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.tenant.deleteMany();
}
```

- [ ] **Step 3: Write the failing test for login**

`test/routes/auth.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../../src/app";
import { prisma } from "../../src/prisma";
import { hashPassword } from "../../src/lib/password";
import { resetDb } from "../helpers/reset-db";

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedProfessional() {
    const tenant = await prisma.tenant.create({ data: { name: "Mühür" } });
    return prisma.verifiedProfessional.create({
      data: {
        tenantId: tenant.id,
        name: "Yağmur",
        email: "yagmur@muhur.com",
        passwordHash: await hashPassword("changeme123"),
        languages: ["TR", "EN", "FR"],
      },
    });
  }

  it("returns a token for correct credentials", async () => {
    await seedProfessional();
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "yagmur@muhur.com", password: "changeme123" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeTypeOf("string");
  });

  it("rejects an unknown email", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "nobody@muhur.com", password: "whatever" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects the wrong password", async () => {
    await seedProfessional();
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "yagmur@muhur.com", password: "wrong-password" },
    });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx dotenv -e .env.test -- npx vitest run test/routes/auth.test.ts`
Expected: FAIL — `Cannot find module '../../src/routes/auth.routes'`

- [ ] **Step 5: Write `src/routes/auth.routes.ts`**

```typescript
import { FastifyInstance } from "fastify";
import { prisma } from "../prisma";
import { verifyPassword } from "../lib/password";
import { signAuthToken } from "../lib/jwt";

interface LoginBody {
  email: string;
  password: string;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: LoginBody }>("/api/auth/login", async (request, reply) => {
    const { email, password } = request.body;

    const professional = await prisma.verifiedProfessional.findUnique({ where: { email } });
    if (!professional) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const valid = await verifyPassword(password, professional.passwordHash);
    if (!valid) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const token = signAuthToken({ professionalId: professional.id, email: professional.email });
    return reply.send({ token });
  });
}
```

- [ ] **Step 6: Wire the route and error handler into `src/app.ts`**

```typescript
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
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx dotenv -e .env.test -- npx vitest run test/routes/auth.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 8: Write `prisma/seed.ts`**

```typescript
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: { id: "00000000-0000-0000-0000-000000000001", name: "Mühür" },
  });

  await prisma.verifiedProfessional.upsert({
    where: { email: "yagmur@muhur.com" },
    update: {},
    create: {
      tenantId: tenant.id,
      name: "Yağmur",
      email: "yagmur@muhur.com",
      passwordHash: await hashPassword("changeme123"),
      languages: ["TR", "EN", "FR"],
      region: "TR",
      capacity: 10,
    },
  });

  const customer = await prisma.customer.upsert({
    where: { email: "demo@musteri.com" },
    update: {},
    create: {
      tenantId: tenant.id,
      name: "Demo Müşteri",
      email: "demo@musteri.com",
      type: "INDIVIDUAL",
    },
  });

  console.log("Seed complete.");
  console.log("Professional login: yagmur@muhur.com / changeme123");
  console.log("Demo customer id:", customer.id);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 9: Add the seed script to `package.json` and run it against dev**

Add to `"scripts"`: `"prisma:seed": "tsx prisma/seed.ts"`

```bash
npx dotenv -e .env -- npm run prisma:seed
```

Expected: prints the professional login and a demo customer id. Copy that id somewhere — Task 12 needs it as `TEST_CUSTOMER_ID`.

- [ ] **Step 10: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: add login route, error handler, and seed script"
```

---

### Task 6: DOCX Extraction Service

**Files:**
- Create: `muhur-backend/src/services/extraction.service.ts`
- Test: `muhur-backend/test/services/extraction.test.ts`

**Interfaces:**
- Produces: `extractDocxText(buffer: Buffer): Promise<string>` — used by Task 8's `documents.routes.ts`.

- [ ] **Step 1: Install dependencies**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR/muhur-backend"
npm install mammoth
npm install -D docx
```

- [ ] **Step 2: Write the failing test**

`test/services/extraction.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { extractDocxText } from "../../src/services/extraction.service";

async function buildDocxFixture(text: string): Promise<Buffer> {
  const doc = new Document({
    sections: [{ children: [new Paragraph({ children: [new TextRun(text)] })] }],
  });
  return Packer.toBuffer(doc);
}

describe("extractDocxText", () => {
  it("extracts plain text from a docx buffer", async () => {
    const buffer = await buildDocxFixture("Nüfus cüzdanı örneğidir.");
    const text = await extractDocxText(buffer);
    expect(text).toBe("Nüfus cüzdanı örneğidir.");
  });

  it("trims surrounding whitespace", async () => {
    const buffer = await buildDocxFixture("  Doğum belgesi  ");
    const text = await extractDocxText(buffer);
    expect(text).toBe("Doğum belgesi");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/services/extraction.test.ts`
Expected: FAIL — `Cannot find module '../../src/services/extraction.service'`

- [ ] **Step 4: Write `src/services/extraction.service.ts`**

```typescript
import mammoth from "mammoth";

export async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value.trim();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/services/extraction.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: add docx text extraction service"
```

---

### Task 7: Gemini Translation Service

**Files:**
- Create: `muhur-backend/src/services/gemini.service.ts`
- Test: `muhur-backend/test/services/gemini.test.ts`

**Interfaces:**
- Produces: `TranslationProvider` interface (`translate`, `suggest`), `GeminiService implements TranslationProvider`, `TranslateInput`, `SuggestInput` types — used by Task 8, 9, 12.

- [ ] **Step 1: Install dependency**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR/muhur-backend"
npm install @google/generative-ai
```

- [ ] **Step 2: Write the failing test**

`test/services/gemini.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const generateContentMock = vi.fn();
const getGenerativeModelMock = vi.fn(() => ({ generateContent: generateContentMock }));

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: getGenerativeModelMock,
  })),
}));

import { GeminiService } from "../../src/services/gemini.service";

describe("GeminiService", () => {
  beforeEach(() => {
    generateContentMock.mockReset();
  });

  it("translates plain text and returns the response text", async () => {
    generateContentMock.mockResolvedValue({
      response: { text: () => "Translated text" },
    });

    const service = new GeminiService("fake-key");
    const result = await service.translate({
      text: "Merhaba dünya",
      sourceLang: "TR",
      targetLang: "EN",
    });

    expect(result).toBe("Translated text");
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it("translates a file buffer via inlineData", async () => {
    generateContentMock.mockResolvedValue({
      response: { text: () => "Translated from image" },
    });

    const service = new GeminiService("fake-key");
    const result = await service.translate({
      fileBuffer: Buffer.from("fake-pdf-bytes"),
      mimeType: "application/pdf",
      sourceLang: "TR",
      targetLang: "EN",
    });

    expect(result).toBe("Translated from image");
    const callArgs = generateContentMock.mock.calls[0][0];
    expect(callArgs.some((part: any) => part.inlineData)).toBe(true);
  });

  it("throws when neither text nor fileBuffer is given", async () => {
    const service = new GeminiService("fake-key");
    await expect(
      service.translate({ sourceLang: "TR", targetLang: "EN" } as any)
    ).rejects.toThrow();
  });

  it("returns parsed suggestions", async () => {
    generateContentMock.mockResolvedValue({
      response: { text: () => '["Hello", "Hi", "Greetings"]' },
    });

    const service = new GeminiService("fake-key");
    const result = await service.suggest({
      text: "Merhaba",
      context: "Merhaba dünya",
      sourceLang: "TR",
      targetLang: "EN",
    });

    expect(result).toEqual(["Hello", "Hi", "Greetings"]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/services/gemini.test.ts`
Expected: FAIL — `Cannot find module '../../src/services/gemini.service'`

- [ ] **Step 4: Write `src/services/gemini.service.ts`**

```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";

export interface TranslateInput {
  text?: string;
  fileBuffer?: Buffer;
  mimeType?: string;
  sourceLang: string;
  targetLang: string;
}

export interface SuggestInput {
  text: string;
  context: string;
  sourceLang: string;
  targetLang: string;
}

export interface TranslationProvider {
  translate(input: TranslateInput): Promise<string>;
  suggest(input: SuggestInput): Promise<string[]>;
}

const MODEL_NAME = "gemini-2.0-flash";

export class GeminiService implements TranslationProvider {
  private client: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async translate(input: TranslateInput): Promise<string> {
    if (!input.text && !input.fileBuffer) {
      throw new Error("translate requires either text or fileBuffer");
    }

    const model = this.client.getGenerativeModel({ model: MODEL_NAME });
    const prompt = `Translate the following official document from ${input.sourceLang} to ${input.targetLang}. Return only the translated text, no commentary or notes.`;

    const parts: unknown[] = [{ text: prompt }];
    if (input.fileBuffer) {
      parts.push({
        inlineData: {
          data: input.fileBuffer.toString("base64"),
          mimeType: input.mimeType ?? "application/octet-stream",
        },
      });
    } else {
      parts.push({ text: input.text });
    }

    const result = await model.generateContent(parts as never);
    return result.response.text();
  }

  async suggest(input: SuggestInput): Promise<string[]> {
    const model = this.client.getGenerativeModel({ model: MODEL_NAME });
    const prompt = `Given this sentence in ${input.sourceLang}: "${input.context}"\n\nProvide 3 alternative ${input.targetLang} translations for this specific phrase: "${input.text}"\n\nReturn only a JSON array of 3 strings, no other text.`;

    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim();
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    return JSON.parse(cleaned);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/services/gemini.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: add Gemini translation service with mockable provider interface"
```

---

### Task 8: POST /api/documents (Upload + Translate)

**Files:**
- Create: `muhur-backend/src/routes/documents.routes.ts`
- Modify: `muhur-backend/src/app.ts`
- Test: `muhur-backend/test/routes/documents.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 2), `extractDocxText` (Task 6), `TranslationProvider` (Task 7).
- Produces: `POST /api/documents` route registered via `documentsRoutes(app, { geminiService })`; `buildApp(options?: { geminiService?: TranslationProvider })` — the `geminiService` override is what Task 9's tests and later tasks rely on to avoid real API calls.

- [ ] **Step 1: Install test-only dependency**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR/muhur-backend"
npm install -D form-data
```

- [ ] **Step 2: Write the failing test**

`test/routes/documents.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import FormData from "form-data";
import { Document as DocxDocument, Packer, Paragraph, TextRun } from "docx";
import { buildApp } from "../../src/app";
import { prisma } from "../../src/prisma";
import { resetDb } from "../helpers/reset-db";
import type { TranslationProvider } from "../../src/services/gemini.service";

function fakeProvider(overrides: Partial<TranslationProvider> = {}): TranslationProvider {
  return {
    translate: vi.fn().mockResolvedValue("Translated output"),
    suggest: vi.fn().mockResolvedValue(["a", "b", "c"]),
    ...overrides,
  };
}

async function seedCustomer() {
  const tenant = await prisma.tenant.create({ data: { name: "Mühür" } });
  return prisma.customer.create({
    data: { tenantId: tenant.id, name: "Demo Müşteri", email: "demo@musteri.com" },
  });
}

describe("POST /api/documents", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates an order, document, and ready draft from pasted text", async () => {
    const customer = await seedCustomer();
    const geminiService = fakeProvider();
    const app = buildApp({ geminiService });

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

    const draft = await prisma.draft.findUnique({ where: { id: body.draftId } });
    expect(draft?.status).toBe("READY");
    expect(draft?.draftText).toBe("Translated output");

    const order = await prisma.order.findUnique({ where: { id: body.orderId } });
    expect(order?.status).toBe("DRAFTS_READY");
  });

  it("extracts text from an uploaded docx file before translating", async () => {
    const customer = await seedCustomer();
    const geminiService = fakeProvider();
    const app = buildApp({ geminiService });

    const docxDoc = new DocxDocument({
      sections: [{ children: [new Paragraph({ children: [new TextRun("Doğum belgesi")] })] }],
    });
    const docxBuffer = await Packer.toBuffer(docxDoc);

    const form = new FormData();
    form.append("customerId", customer.id);
    form.append("sourceLang", "TR");
    form.append("targetLang", "EN");
    form.append("file", docxBuffer, {
      filename: "belge.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/documents",
      headers: form.getHeaders(),
      payload: form.getBuffer(),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    const document = await prisma.document.findUnique({ where: { id: body.documentId } });
    expect(document?.sourceFormat).toBe("DOCX");
    expect(document?.extractedText).toBe("Doğum belgesi");
    expect(geminiService.translate).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Doğum belgesi" })
    );
  });

  it("returns 400 when neither file nor pastedText is provided", async () => {
    const customer = await seedCustomer();
    const app = buildApp({ geminiService: fakeProvider() });

    const form = new FormData();
    form.append("customerId", customer.id);
    form.append("sourceLang", "TR");
    form.append("targetLang", "EN");

    const res = await app.inject({
      method: "POST",
      url: "/api/documents",
      headers: form.getHeaders(),
      payload: form.getBuffer(),
    });

    expect(res.statusCode).toBe(400);
  });

  it("marks the draft failed and returns 502 when Gemini errors", async () => {
    const customer = await seedCustomer();
    const geminiService = fakeProvider({
      translate: vi.fn().mockRejectedValue(new Error("quota exceeded")),
    });
    const app = buildApp({ geminiService });

    const form = new FormData();
    form.append("customerId", customer.id);
    form.append("sourceLang", "TR");
    form.append("targetLang", "EN");
    form.append("pastedText", "Merhaba dünya");

    const res = await app.inject({
      method: "POST",
      url: "/api/documents",
      headers: form.getHeaders(),
      payload: form.getBuffer(),
    });

    expect(res.statusCode).toBe(502);

    const drafts = await prisma.draft.findMany();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].status).toBe("FAILED");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx dotenv -e .env.test -- npx vitest run test/routes/documents.test.ts`
Expected: FAIL — `buildApp` doesn't accept options yet / module not found

- [ ] **Step 4: Write `src/routes/documents.routes.ts`**

```typescript
import { FastifyInstance } from "fastify";
import { prisma } from "../prisma";
import { extractDocxText } from "../services/extraction.service";
import type { TranslationProvider } from "../services/gemini.service";

interface DocumentsRoutesOptions {
  geminiService: TranslationProvider;
}

const MIME_TO_FORMAT: Record<string, "PDF" | "IMAGE" | "DOCX"> = {
  "application/pdf": "PDF",
  "image/png": "IMAGE",
  "image/jpeg": "IMAGE",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
};

export async function documentsRoutes(app: FastifyInstance, opts: DocumentsRoutesOptions): Promise<void> {
  app.post("/api/documents", async (request, reply) => {
    const parts = request.parts();

    let customerId: string | undefined;
    let sourceLang: string | undefined;
    let targetLang: string | undefined;
    let pastedText: string | undefined;
    let fileBuffer: Buffer | undefined;
    let mimeType: string | undefined;

    for await (const part of parts) {
      if (part.type === "file") {
        fileBuffer = await part.toBuffer();
        mimeType = part.mimetype;
      } else if (part.fieldname === "customerId") {
        customerId = part.value as string;
      } else if (part.fieldname === "sourceLang") {
        sourceLang = part.value as string;
      } else if (part.fieldname === "targetLang") {
        targetLang = part.value as string;
      } else if (part.fieldname === "pastedText") {
        pastedText = part.value as string;
      }
    }

    if (!customerId || !sourceLang || !targetLang) {
      return reply.code(400).send({ error: "customerId, sourceLang, targetLang are required" });
    }
    if (!fileBuffer && !pastedText) {
      return reply.code(400).send({ error: "Either a file or pastedText must be provided" });
    }

    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) {
      return reply.code(400).send({ error: "Unknown customerId" });
    }

    const order = await prisma.order.create({
      data: { tenantId: customer.tenantId, customerId: customer.id, status: "RECEIVED" },
    });

    let sourceFormat: "PDF" | "IMAGE" | "DOCX" | "PASTED_TEXT";
    let extractedText: string | null = null;

    if (pastedText) {
      sourceFormat = "PASTED_TEXT";
      extractedText = pastedText;
    } else {
      const format = mimeType ? MIME_TO_FORMAT[mimeType] : undefined;
      if (!format) {
        return reply.code(400).send({ error: `Unsupported file type: ${mimeType ?? "unknown"}` });
      }
      sourceFormat = format;
      if (format === "DOCX") {
        extractedText = await extractDocxText(fileBuffer!);
      }
    }

    const document = await prisma.document.create({
      data: {
        tenantId: customer.tenantId,
        customerId: customer.id,
        orderId: order.id,
        sourceFormat,
        extractedText,
        sourceLang,
        targetLang,
        status: "READY",
      },
    });

    await prisma.order.update({ where: { id: order.id }, data: { status: "AI_DRAFTING" } });

    const draft = await prisma.draft.create({
      data: { documentId: document.id, provider: "gemini", status: "PENDING" },
    });

    try {
      const translated = extractedText
        ? await opts.geminiService.translate({ text: extractedText, sourceLang, targetLang })
        : await opts.geminiService.translate({ fileBuffer, mimeType, sourceLang, targetLang });

      await prisma.draft.update({
        where: { id: draft.id },
        data: { draftText: translated, status: "READY" },
      });
      await prisma.order.update({ where: { id: order.id }, data: { status: "DRAFTS_READY" } });
    } catch (err) {
      await prisma.draft.update({ where: { id: draft.id }, data: { status: "FAILED" } });
      request.log.error(err, "Gemini translation failed");
      return reply.code(502).send({ error: "AI translation failed, please retry" });
    }

    return reply.code(201).send({ orderId: order.id, documentId: document.id, draftId: draft.id });
  });
}
```

- [ ] **Step 5: Update `src/app.ts` to register `@fastify/multipart`, accept `geminiService`, and register the route**

```typescript
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
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx dotenv -e .env.test -- npx vitest run test/routes/documents.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 7: Run the full test suite to check for regressions**

Run: `npx dotenv -e .env.test -- npx vitest run`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: add POST /api/documents upload-and-translate route"
```

---

### Task 9: GET /api/orders/:id

**Files:**
- Create: `muhur-backend/src/routes/orders.routes.ts`
- Modify: `muhur-backend/src/app.ts`
- Test: `muhur-backend/test/routes/orders.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 2), `requireAuth` (Task 4).
- Produces: `GET /api/orders/:id`, registered via `ordersRoutes(app)` — also carries the `PATCH /api/orders/:id/finalize` route added in Task 11, so both share this file.

- [ ] **Step 1: Write the failing test**

`test/routes/orders.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../../src/app";
import { prisma } from "../../src/prisma";
import { hashPassword } from "../../src/lib/password";
import { signAuthToken } from "../../src/lib/jwt";
import { resetDb } from "../helpers/reset-db";

describe("GET /api/orders/:id", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedOrderWithDraft() {
    const tenant = await prisma.tenant.create({ data: { name: "Mühür" } });
    const customer = await prisma.customer.create({
      data: { tenantId: tenant.id, name: "Demo Müşteri", email: "demo@musteri.com" },
    });
    const professional = await prisma.verifiedProfessional.create({
      data: {
        tenantId: tenant.id,
        name: "Yağmur",
        email: "yagmur@muhur.com",
        passwordHash: await hashPassword("changeme123"),
        languages: ["TR", "EN"],
      },
    });
    const order = await prisma.order.create({
      data: { tenantId: tenant.id, customerId: customer.id, status: "DRAFTS_READY" },
    });
    const document = await prisma.document.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        orderId: order.id,
        sourceFormat: "PASTED_TEXT",
        extractedText: "Merhaba dünya",
        sourceLang: "TR",
        targetLang: "EN",
        status: "READY",
      },
    });
    await prisma.draft.create({
      data: { documentId: document.id, provider: "gemini", draftText: "Hello world", status: "READY" },
    });
    return { order, professional };
  }

  it("rejects requests without a token", async () => {
    const { order } = await seedOrderWithDraft();
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: `/api/orders/${order.id}` });
    expect(res.statusCode).toBe(401);
  });

  it("returns the order with documents and drafts for an authenticated request", async () => {
    const { order, professional } = await seedOrderWithDraft();
    const token = signAuthToken({ professionalId: professional.id, email: professional.email });
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: `/api/orders/${order.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(order.id);
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0].drafts[0].draftText).toBe("Hello world");
  });

  it("returns 404 for an unknown order id", async () => {
    const tenant = await prisma.tenant.create({ data: { name: "Mühür" } });
    const professional = await prisma.verifiedProfessional.create({
      data: {
        tenantId: tenant.id,
        name: "Yağmur",
        email: "yagmur@muhur.com",
        passwordHash: await hashPassword("changeme123"),
        languages: ["TR", "EN"],
      },
    });
    const token = signAuthToken({ professionalId: professional.id, email: professional.email });
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/orders/00000000-0000-0000-0000-000000000000",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx dotenv -e .env.test -- npx vitest run test/routes/orders.test.ts`
Expected: FAIL — 404s become connection errors / route not registered

- [ ] **Step 3: Write `src/routes/orders.routes.ts`**

```typescript
import { FastifyInstance } from "fastify";
import { prisma } from "../prisma";
import { requireAuth } from "../lib/auth-guard";

export async function ordersRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/orders/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        customer: true,
        documents: { include: { drafts: true, finalTranslation: true } },
      },
    });

    if (!order) {
      return reply.code(404).send({ error: "Order not found" });
    }

    return reply.send(order);
  });
}
```

- [ ] **Step 4: Register the route in `src/app.ts`**

Add the import and registration:

```typescript
import { ordersRoutes } from "./routes/orders.routes";
```

```typescript
  app.register(documentsRoutes, { geminiService });
  app.register(ordersRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx dotenv -e .env.test -- npx vitest run test/routes/orders.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: add GET /api/orders/:id route"
```

---

### Task 10: POST /api/documents/:id/suggest

**Files:**
- Modify: `muhur-backend/src/routes/documents.routes.ts`
- Modify: `muhur-backend/test/routes/documents.test.ts`

**Interfaces:**
- Consumes: `requireAuth` (Task 4), `TranslationProvider.suggest` (Task 7).
- Produces: `POST /api/documents/:id/suggest` → `{ suggestions: string[] }`.

- [ ] **Step 1: Add the failing test to `test/routes/documents.test.ts`**

Add `signAuthToken` and `hashPassword` imports at the top:

```typescript
import { signAuthToken } from "../../src/lib/jwt";
import { hashPassword } from "../../src/lib/password";
```

Append this `describe` block at the end of the file:

```typescript
describe("POST /api/documents/:id/suggest", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedDocumentAndProfessional() {
    const tenant = await prisma.tenant.create({ data: { name: "Mühür" } });
    const customer = await prisma.customer.create({
      data: { tenantId: tenant.id, name: "Demo Müşteri", email: "demo@musteri.com" },
    });
    const professional = await prisma.verifiedProfessional.create({
      data: {
        tenantId: tenant.id,
        name: "Yağmur",
        email: "yagmur@muhur.com",
        passwordHash: await hashPassword("changeme123"),
        languages: ["TR", "EN"],
      },
    });
    const order = await prisma.order.create({
      data: { tenantId: tenant.id, customerId: customer.id, status: "DRAFTS_READY" },
    });
    const document = await prisma.document.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        orderId: order.id,
        sourceFormat: "PASTED_TEXT",
        extractedText: "Merhaba dünya",
        sourceLang: "TR",
        targetLang: "EN",
        status: "READY",
      },
    });
    return { document, professional };
  }

  it("rejects requests without a token", async () => {
    const { document } = await seedDocumentAndProfessional();
    const app = buildApp({ geminiService: fakeProvider() });
    const res = await app.inject({
      method: "POST",
      url: `/api/documents/${document.id}/suggest`,
      payload: { text: "Merhaba", context: "Merhaba dünya" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns suggestions for an authenticated request", async () => {
    const { document, professional } = await seedDocumentAndProfessional();
    const token = signAuthToken({ professionalId: professional.id, email: professional.email });
    const geminiService = fakeProvider({
      suggest: vi.fn().mockResolvedValue(["Hello", "Hi", "Greetings"]),
    });
    const app = buildApp({ geminiService });

    const res = await app.inject({
      method: "POST",
      url: `/api/documents/${document.id}/suggest`,
      headers: { authorization: `Bearer ${token}` },
      payload: { text: "Merhaba", context: "Merhaba dünya" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().suggestions).toEqual(["Hello", "Hi", "Greetings"]);
  });

  it("returns 404 for an unknown document id", async () => {
    const { professional } = await seedDocumentAndProfessional();
    const token = signAuthToken({ professionalId: professional.id, email: professional.email });
    const app = buildApp({ geminiService: fakeProvider() });

    const res = await app.inject({
      method: "POST",
      url: "/api/documents/00000000-0000-0000-0000-000000000000/suggest",
      headers: { authorization: `Bearer ${token}` },
      payload: { text: "Merhaba", context: "Merhaba dünya" },
    });

    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx dotenv -e .env.test -- npx vitest run test/routes/documents.test.ts`
Expected: FAIL — new tests get 404/connection errors, route doesn't exist

- [ ] **Step 3: Add the route to `src/routes/documents.routes.ts`**

Add `requireAuth` import at the top:

```typescript
import { requireAuth } from "../lib/auth-guard";
```

Append inside `documentsRoutes`, after the existing `app.post("/api/documents", ...)` block:

```typescript
  app.post(
    "/api/documents/:id/suggest",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { text, context } = request.body as { text: string; context: string };

      const document = await prisma.document.findUnique({ where: { id } });
      if (!document) {
        return reply.code(404).send({ error: "Document not found" });
      }

      try {
        const suggestions = await opts.geminiService.suggest({
          text,
          context,
          sourceLang: document.sourceLang,
          targetLang: document.targetLang,
        });
        return reply.send({ suggestions });
      } catch (err) {
        request.log.error(err, "Gemini suggestion failed");
        return reply.code(502).send({ error: "AI suggestion failed, please retry" });
      }
    }
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx dotenv -e .env.test -- npx vitest run test/routes/documents.test.ts`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: add POST /api/documents/:id/suggest route"
```

---

### Task 11: PATCH /api/orders/:id/finalize

**Files:**
- Modify: `muhur-backend/src/routes/orders.routes.ts`
- Modify: `muhur-backend/test/routes/orders.test.ts`

**Interfaces:**
- Consumes: `requireAuth` (Task 4), `request.professional` (Task 4).
- Produces: `PATCH /api/orders/:id/finalize` → creates `FinalTranslation`, sets `Order.status = APPROVED`.

- [ ] **Step 1: Add the failing test to `test/routes/orders.test.ts`**

Append this `describe` block at the end of the file:

```typescript
describe("PATCH /api/orders/:id/finalize", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a FinalTranslation and marks the order approved", async () => {
    const { order, professional } = await seedOrderWithDraft();
    const document = await prisma.document.findFirstOrThrow({ where: { orderId: order.id } });
    const token = signAuthToken({ professionalId: professional.id, email: professional.email });
    const app = buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: `/api/orders/${order.id}/finalize`,
      headers: { authorization: `Bearer ${token}` },
      payload: { documentId: document.id, finalText: "Hello world, final." },
    });

    expect(res.statusCode).toBe(201);

    const finalTranslation = await prisma.finalTranslation.findUnique({ where: { documentId: document.id } });
    expect(finalTranslation?.finalText).toBe("Hello world, final.");
    expect(finalTranslation?.editedById).toBe(professional.id);

    const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(updatedOrder?.status).toBe("APPROVED");
  });

  it("returns 400 when the document does not belong to the order", async () => {
    const { order: orderA, professional } = await seedOrderWithDraft();
    const { order: orderB } = await seedOrderWithDraft();
    const documentB = await prisma.document.findFirstOrThrow({ where: { orderId: orderB.id } });
    const token = signAuthToken({ professionalId: professional.id, email: professional.email });
    const app = buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: `/api/orders/${orderA.id}/finalize`,
      headers: { authorization: `Bearer ${token}` },
      payload: { documentId: documentB.id, finalText: "Mismatched." },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for an unknown order id", async () => {
    const { professional } = await seedOrderWithDraft();
    const token = signAuthToken({ professionalId: professional.id, email: professional.email });
    const app = buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: "/api/orders/00000000-0000-0000-0000-000000000000/finalize",
      headers: { authorization: `Bearer ${token}` },
      payload: { documentId: "00000000-0000-0000-0000-000000000000", finalText: "x" },
    });

    expect(res.statusCode).toBe(404);
  });
});
```

Note: `seedOrderWithDraft` is already defined earlier in this file from Task 9 — no need to redefine it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx dotenv -e .env.test -- npx vitest run test/routes/orders.test.ts`
Expected: FAIL — finalize route doesn't exist yet

- [ ] **Step 3: Add the route to `src/routes/orders.routes.ts`**

Append inside `ordersRoutes`, after the existing `app.get("/api/orders/:id", ...)` block:

```typescript
  app.patch(
    "/api/orders/:id/finalize",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { documentId, finalText } = request.body as { documentId: string; finalText: string };
      const professional = request.professional!;

      const order = await prisma.order.findUnique({ where: { id } });
      if (!order) {
        return reply.code(404).send({ error: "Order not found" });
      }

      const document = await prisma.document.findUnique({ where: { id: documentId } });
      if (!document || document.orderId !== id) {
        return reply.code(400).send({ error: "Document does not belong to this order" });
      }

      const finalTranslation = await prisma.finalTranslation.create({
        data: {
          documentId,
          editedById: professional.professionalId,
          finalText,
        },
      });

      await prisma.order.update({ where: { id }, data: { status: "APPROVED" } });

      return reply.code(201).send(finalTranslation);
    }
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx dotenv -e .env.test -- npx vitest run test/routes/orders.test.ts`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Run the full suite**

Run: `npx dotenv -e .env.test -- npx vitest run`
Expected: All tests PASS across every file

- [ ] **Step 6: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: add PATCH /api/orders/:id/finalize route"
```

---

### Task 12: Manual End-to-End Script (Real Gemini Call)

**Files:**
- Create: `muhur-backend/scripts/test-flow.ts`
- Modify: `muhur-backend/package.json`

**Interfaces:**
- Consumes: the running dev server (`npm run dev`) and a real `GEMINI_API_KEY` in `.env`.

This task is a manual verification step, not a unit test — it proves the full stack (Fastify → Prisma → real Postgres → real Gemini API) works end-to-end, which is Faz 1's stated goal.

- [ ] **Step 1: Write `scripts/test-flow.ts`**

```typescript
import FormData from "form-data";

async function main(): Promise<void> {
  const baseUrl = process.env.MUHUR_BASE_URL ?? "http://localhost:3000";
  const customerId = process.env.TEST_CUSTOMER_ID;

  if (!customerId) {
    throw new Error(
      "Set TEST_CUSTOMER_ID to the demo customer id printed by `npm run prisma:seed`."
    );
  }

  const form = new FormData();
  form.append("customerId", customerId);
  form.append("sourceLang", "TR");
  form.append("targetLang", "EN");
  form.append(
    "pastedText",
    "Bu belge nüfus cüzdanı örneğidir. Ad: Ayşe Yılmaz. Doğum tarihi: 01.01.1990."
  );

  const res = await fetch(`${baseUrl}/api/documents`, {
    method: "POST",
    body: form as unknown as BodyInit,
    headers: form.getHeaders(),
  });

  const body = await res.json();
  console.log("Response status:", res.status);
  console.log("Response body:", body);

  if (res.status !== 201) {
    throw new Error("Document upload failed — see response body above.");
  }

  console.log("\nFaz 1 uçtan uca akış başarılı: belge yüklendi, Gemini taslağı üretildi.");
  console.log(`Order id: ${body.orderId}`);
  console.log(`Draft id: ${body.draftId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the script to `package.json`**

Add to `"scripts"`: `"test:flow": "tsx scripts/test-flow.ts"`

- [ ] **Step 3: Run the full stack manually**

In one terminal:

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR/muhur-backend"
docker compose up -d
npx dotenv -e .env -- npm run dev
```

In another terminal, fill in a real key first:

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR/muhur-backend"
# Edit .env and set GEMINI_API_KEY to a real Google AI Studio key, then restart the dev server.
npx dotenv -e .env -- npm run prisma:seed
# Copy the "Demo customer id" printed above.
TEST_CUSTOMER_ID="<paste-id-here>" npx dotenv -e .env -- npm run test:flow
```

Expected: `Response status: 201`, a non-empty `draftText` printed inside the response body, and the final success line printed.

- [ ] **Step 4: Commit**

```bash
cd "/Users/denizokten/Desktop/VAULT/MUHUR"
git add muhur-backend/
git commit -m "feat: add manual end-to-end test-flow script"
```

---

## Faz 1 Tamamlanma Kriteri

Tüm görevler tamamlandığında: `npx dotenv -e .env.test -- npx vitest run` tüm testleri yeşil geçer, ve Task 12'deki manuel script gerçek bir Gemini yanıtıyla `201` döner. Bu noktada Faz 2'ye (prototip UI'sini bu API'ye bağlama) geçilebilir — ayrı bir spec+plan olarak ele alınmalı.
