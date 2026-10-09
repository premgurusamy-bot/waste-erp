import type { Tx } from "./db.js";
import { prisma } from "./db.js";

/** Atomically take the next number of a named sequence. */
export async function nextNumber(db: Tx | typeof prisma, name: string): Promise<number> {
  const rows = await db.$queryRaw<{ value: number }[]>`
    INSERT INTO sequences (name, value) VALUES (${name}, 1)
    ON CONFLICT (name) DO UPDATE SET value = sequences.value + 1
    RETURNING value`;
  return Number(rows[0].value);
}

export async function nextCode(db: Tx | typeof prisma, prefix: string, width = 6): Promise<string> {
  const n = await nextNumber(db, prefix);
  return `${prefix}-${String(n).padStart(width, "0")}`;
}

/** Code prefix -> table/column, used to re-align sequences after a restore or import. */
export const CODE_SEQUENCES: { prefix: string; table: string; column: string }[] = [
  { prefix: "CUS", table: "customers", column: "code" },
  { prefix: "TRN", table: "transporters", column: "code" },
  { prefix: "VEH", table: "vehicles", column: "code" },
  { prefix: "DRV", table: "drivers", column: "code" },
  { prefix: "LP", table: "loading_points", column: "code" },
  { prefix: "DP", table: "delivery_points", column: "code" },
  { prefix: "FRT", table: "freight_rates", column: "code" },
  { prefix: "TRP", table: "trips", column: '"tripNumber"' },
  { prefix: "EXP", table: "expenses", column: "code" },
  { prefix: "RCP", table: "customer_receipts", column: "code" },
  { prefix: "STL", table: "transporter_settlements", column: "code" },
  { prefix: "TPY", table: "transporter_payments", column: "code" },
  { prefix: "DOC", table: "documents", column: "code" },
];

/** Set every sequence to at least the highest number already used, so new records never collide with restored ones. */
export async function syncSequences(db: Tx | typeof prisma) {
  for (const s of CODE_SEQUENCES) {
    const rows = await db.$queryRawUnsafe<{ max: number | null }[]>(
      `SELECT MAX(CAST(substring(${s.column} from '([0-9]+)$') AS INTEGER)) AS max FROM ${s.table} WHERE ${s.column} LIKE '${s.prefix}-%'`,
    );
    const max = Number(rows[0]?.max ?? 0);
    await db.$executeRaw`INSERT INTO sequences (name, value) VALUES (${s.prefix}, ${max})
      ON CONFLICT (name) DO UPDATE SET value = GREATEST(sequences.value, ${max})`;
  }
  // invoice numbers: PREFIX/2026-27/0001 -> sequence "INV:PREFIX/2026-27"
  const inv = await db.$queryRaw<{ series: string; max: number }[]>`
    SELECT regexp_replace("invoiceNumber", '/[0-9]+$', '') AS series,
           MAX(CAST(substring("invoiceNumber" from '/([0-9]+)$') AS INTEGER)) AS max
    FROM customer_invoices WHERE "invoiceNumber" ~ '/[0-9]+$' GROUP BY 1`;
  for (const r of inv) {
    const name = `INV:${r.series}`;
    const max = Number(r.max);
    await db.$executeRaw`INSERT INTO sequences (name, value) VALUES (${name}, ${max})
      ON CONFLICT (name) DO UPDATE SET value = GREATEST(sequences.value, ${max})`;
  }
}
