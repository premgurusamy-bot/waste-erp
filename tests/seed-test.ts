import { PrismaClient } from "@prisma/client";
import { seedBase, seedDemoUsers } from "../src/server/seed/base";

const prisma = new PrismaClient();
seedBase(prisma, { adminPassword: process.env.SEED_ADMIN_PASSWORD || "Admin@123" })
  .then(() => seedDemoUsers(prisma, process.env.SEED_DEMO_PASSWORD || "Demo@123"))
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
