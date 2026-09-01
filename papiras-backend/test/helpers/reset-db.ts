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
