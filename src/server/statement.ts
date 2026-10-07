import { prisma } from "@/lib/db";
import { addDays, dateOnly, num, round2 } from "@/lib/utils";

export type StatementLine = { date: Date; type: string; number: string; description: string; debit: number; credit: number; balance: number };

/** Customer statement: invoices (debit) and receipts (credit) with running balance. */
export async function customerStatement(customerId: string, fromISO: string, toISO: string) {
  const from = dateOnly(fromISO);
  const to = dateOnly(toISO);
  const [invBefore, rcpBefore, invoices, receipts] = await Promise.all([
    prisma.customerInvoice.aggregate({ where: { customerId, status: "POSTED", date: { lt: from } }, _sum: { total: true } }),
    prisma.receipt.aggregate({ where: { customerId, status: "POSTED", date: { lt: from } }, _sum: { amount: true } }),
    prisma.customerInvoice.findMany({ where: { customerId, status: "POSTED", date: { gte: from, lte: to } }, orderBy: { date: "asc" } }),
    prisma.receipt.findMany({ where: { customerId, status: "POSTED", date: { gte: from, lte: to } }, orderBy: { date: "asc" } }),
  ]);
  const opening = round2(num(invBefore._sum.total) - num(rcpBefore._sum.amount));
  const events = [
    ...invoices.map((i) => ({
      date: i.date,
      type: "Invoice",
      number: i.number,
      description: i.periodFrom ? `Services ${i.periodFrom.toISOString().slice(0, 10)} to ${i.periodTo?.toISOString().slice(0, 10)}` : "Invoice",
      debit: num(i.total),
      credit: 0,
    })),
    ...receipts.map((r) => ({ date: r.date, type: "Receipt", number: r.number, description: `${r.mode.replace("_", " ")}${r.reference ? ` · ${r.reference}` : ""}`, debit: 0, credit: num(r.amount) })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || (a.type === "Invoice" ? -1 : 1));
  let bal = opening;
  const lines: StatementLine[] = events.map((e) => {
    bal = round2(bal + e.debit - e.credit);
    return { ...e, balance: bal };
  });
  return {
    opening,
    lines,
    closing: bal,
    totalDebit: round2(events.reduce((s, e) => s + e.debit, 0)),
    totalCredit: round2(events.reduce((s, e) => s + e.credit, 0)),
    to: addDays(to, 0),
  };
}
