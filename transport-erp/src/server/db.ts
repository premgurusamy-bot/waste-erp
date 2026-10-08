import { PrismaClient, Prisma } from "@prisma/client";

const g = globalThis as unknown as { __prisma?: PrismaClient };
export const prisma = g.__prisma ?? new PrismaClient({ log: ["error"] });
g.__prisma = prisma;

export type Tx = Prisma.TransactionClient;
export { Prisma };
