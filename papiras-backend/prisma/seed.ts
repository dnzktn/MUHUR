import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: { id: "00000000-0000-0000-0000-000000000001", name: "Papiras" },
  });

  await prisma.verifiedProfessional.upsert({
    where: { email: "yagmur@papiras.com" },
    update: {},
    create: {
      tenantId: tenant.id,
      name: "Yağmur",
      email: "yagmur@papiras.com",
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
  console.log("Professional login: yagmur@papiras.com / changeme123");
  console.log("Demo customer id:", customer.id);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
