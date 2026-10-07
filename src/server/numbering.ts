import type { Tx } from "@/lib/db";

export const SEQUENCE_DEFAULTS: Record<string, { name: string; prefix: string; includeYear: boolean; padding: number }> = {
  CUSTOMER: { name: "Customer Code", prefix: "CUS-", includeYear: false, padding: 5 },
  SITE: { name: "Customer Site Code", prefix: "SITE-", includeYear: false, padding: 5 },
  CONTRACT: { name: "Contract Number", prefix: "CON-", includeYear: true, padding: 4 },
  PICKUP: { name: "Pickup Request", prefix: "PICK-", includeYear: false, padding: 5 },
  SCHEDULE: { name: "Collection Schedule", prefix: "SCH-", includeYear: false, padding: 5 },
  COLLECTION: { name: "Collection Entry", prefix: "COL-", includeYear: false, padding: 5 },
  WEIGHMENT: { name: "Weighment", prefix: "WT-", includeYear: false, padding: 5 },
  PROCESSING: { name: "Processing Batch", prefix: "PROC-", includeYear: false, padding: 5 },
  CUSTOMER_INVOICE: { name: "Customer Invoice", prefix: "INV-", includeYear: true, padding: 5 },
  SALES_INVOICE: { name: "Recyclable Sales Invoice", prefix: "SALE-", includeYear: true, padding: 5 },
  RECEIPT: { name: "Receipt", prefix: "RCPT-", includeYear: false, padding: 5 },
  PAYMENT: { name: "Supplier Payment", prefix: "PAY-", includeYear: false, padding: 5 },
  PURCHASE: { name: "Purchase", prefix: "PUR-", includeYear: true, padding: 5 },
  EXPENSE: { name: "Expense", prefix: "EXP-", includeYear: false, padding: 5 },
  JOURNAL: { name: "Journal Entry", prefix: "JV-", includeYear: true, padding: 6 },
  DRIVER: { name: "Driver Code", prefix: "DRV-", includeYear: false, padding: 4 },
  BUYER: { name: "Buyer Code", prefix: "BUY-", includeYear: false, padding: 4 },
  SUPPLIER: { name: "Supplier Code", prefix: "SUP-", includeYear: false, padding: 4 },
};

/**
 * Atomically reserve the next document number. Must be called inside a DB transaction;
 * the row lock (UPDATE ... RETURNING) serialises concurrent requests.
 * Year-based sequences keep a separate counter per year ("KEY@2026").
 */
export async function nextNumber(tx: Tx, key: string, date: Date = new Date()): Promise<string> {
  const def = SEQUENCE_DEFAULTS[key];
  if (!def) throw new Error(`Unknown sequence ${key}`);
  const config =
    (await tx.numberSequence.findUnique({ where: { key } })) ??
    (await tx.numberSequence.upsert({ where: { key }, update: {}, create: { key, ...def } }));

  const year = date.getUTCFullYear();
  const counterKey = config.includeYear ? `${key}@${year}` : key;
  if (counterKey !== key) {
    await tx.$executeRaw`INSERT INTO number_sequences ("key","name","prefix","includeYear","padding","nextNumber","currentYear","updatedAt")
      VALUES (${counterKey}, ${`${config.name} ${year}`}, ${config.prefix}, true, ${config.padding}, 1, ${year}, now())
      ON CONFLICT ("key") DO NOTHING`;
  }
  const rows = await tx.$queryRaw<{ n: number }[]>`
    UPDATE number_sequences SET "nextNumber" = "nextNumber" + 1, "updatedAt" = now()
    WHERE "key" = ${counterKey} RETURNING "nextNumber" - 1 AS n`;
  const n = Number(rows[0].n);
  const padded = String(n).padStart(config.padding, "0");
  return config.includeYear ? `${config.prefix}${year}-${padded}` : `${config.prefix}${padded}`;
}
