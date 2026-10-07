import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { seedBase, seedDemoUsers } from "../src/server/seed/base";

const prisma = new PrismaClient();

async function main() {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) throw new Error("Set SEED_ADMIN_PASSWORD in the environment before seeding.");
  console.log("Seeding base configuration...");
  await seedBase(prisma, { adminPassword });
  if (process.env.SEED_DEMO !== "false") {
    await seedDemoUsers(prisma, process.env.SEED_DEMO_PASSWORD || adminPassword);
    // Imported lazily: the demo generator uses the app's service layer (and its shared Prisma client).
    const { seedDemo } = await import("../src/server/seed/demo");
    await seedDemo(prisma);
  }
  console.log("Seed finished.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
