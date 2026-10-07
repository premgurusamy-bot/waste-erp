"use server";

import { prisma } from "@/lib/db";
import { num, round2 } from "@/lib/utils";
import { act } from "@/server/action";
import { assertCan } from "@/server/context";
import { allocateReceipt, cancelPayment, cancelReceipt, createPayment, createReceipt } from "@/server/services/receipts";

const P = ["/receipts", "/payments", "/outstanding", "/invoices", "/sales", "/purchases", "/expenses", "/dashboard"];

export type OpenDoc = { id: string; number: string; date: string; dueDate: string | null; total: number; balance: number; docType?: "PURCHASE" | "EXPENSE" };

/** Open (unpaid/partly paid) documents for a party, oldest first. */
export async function openDocsAction(partyType: "CUSTOMER" | "BUYER" | "SUPPLIER", partyId: string) {
  return act(async (ctx): Promise<OpenDoc[]> => {
    assertCan(ctx, "receipts.view");
    const map = (d: { id: string; number: string; date: Date; dueDate: Date | null; total: unknown; paid: unknown }, docType?: "PURCHASE" | "EXPENSE"): OpenDoc => ({
      id: d.id, number: d.number, date: d.date.toISOString().slice(0, 10), dueDate: d.dueDate?.toISOString().slice(0, 10) ?? null,
      total: num(d.total as number), balance: round2(num(d.total as number) - num(d.paid as number)), docType,
    });
    if (partyType === "CUSTOMER") {
      const rows = await prisma.customerInvoice.findMany({ where: { customerId: partyId, status: "POSTED", paymentStatus: { not: "PAID" } }, orderBy: { date: "asc" } });
      return rows.map((r) => map({ ...r, paid: r.amountReceived }));
    }
    if (partyType === "BUYER") {
      const rows = await prisma.salesInvoice.findMany({ where: { buyerId: partyId, status: "POSTED", paymentStatus: { not: "PAID" } }, orderBy: { date: "asc" } });
      return rows.map((r) => map({ ...r, paid: r.amountReceived }));
    }
    const [pur, exp] = await Promise.all([
      prisma.purchase.findMany({ where: { supplierId: partyId, status: "POSTED", paymentStatus: { not: "PAID" } }, orderBy: { date: "asc" } }),
      prisma.expense.findMany({ where: { supplierId: partyId, status: "POSTED", paymentMode: "CREDIT", paymentStatus: { not: "PAID" } }, orderBy: { date: "asc" } }),
    ]);
    return [...pur.map((r) => map({ ...r, paid: r.amountPaid }, "PURCHASE")), ...exp.map((r) => map({ ...r, dueDate: null, paid: r.amountPaid }, "EXPENSE"))].sort((a, b) => a.date.localeCompare(b.date));
  });
}

export async function receiptAction(values: Record<string, unknown>) {
  return act((ctx) => createReceipt(ctx, values), P);
}
export async function allocateReceiptAction(values: Record<string, unknown>) {
  return act((ctx) => allocateReceipt(ctx, values), P);
}
export async function cancelReceiptAction(id: string, reason: string) {
  return act((ctx) => cancelReceipt(ctx, id, reason), P);
}
export async function paymentAction(values: Record<string, unknown>) {
  return act((ctx) => createPayment(ctx, values), P);
}
export async function cancelPaymentAction(id: string, reason: string) {
  return act((ctx) => cancelPayment(ctx, id, reason), P);
}
