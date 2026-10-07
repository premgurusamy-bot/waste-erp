import type { PaymentStatus } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { dateOnly, num, round2, todayISO } from "@/lib/utils";
import { paymentSchema, receiptAllocateSchema, receiptSchema } from "@/lib/validation";
import { ACC, postJournal, reverseJournal } from "../accounting";
import { audit } from "../audit";
import { assertCan, type Ctx } from "../context";
import { AppError } from "../errors";
import { nextNumber } from "../numbering";

export function paymentStatusFor(paid: number, total: number): PaymentStatus {
  if (round2(paid) <= 0) return "UNPAID";
  if (round2(paid) >= round2(total)) return "PAID";
  return "PARTIAL";
}

async function cashBankAccount(tx: Tx, accountId: string) {
  const acc = await tx.ledgerAccount.findUnique({ where: { id: accountId } });
  if (!acc || !["CASH", "BANK"].includes(acc.subType ?? "")) throw new AppError("Select a cash or bank account.", { accountId: "Invalid account" });
  return acc;
}

/** Apply allocations to customer invoices or recyclable sales invoices. */
async function applyAllocations(
  tx: Tx,
  receipt: { id: string; partyType: string; customerId: string | null; buyerId: string | null },
  allocations: { invoiceId: string; amount: number }[],
) {
  let total = 0;
  for (const a of allocations) {
    const amount = round2(a.amount);
    if (receipt.partyType === "CUSTOMER") {
      const inv = await tx.customerInvoice.findUnique({ where: { id: a.invoiceId } });
      if (!inv || inv.customerId !== receipt.customerId || inv.status !== "POSTED") throw new AppError("An allocated invoice is invalid for this customer.");
      const balance = round2(num(inv.total) - num(inv.amountReceived));
      if (amount > balance) throw new AppError(`Allocation of ${amount} exceeds the balance ${balance} on invoice ${inv.number}.`);
      const received = round2(num(inv.amountReceived) + amount);
      await tx.customerInvoice.update({ where: { id: inv.id }, data: { amountReceived: received, paymentStatus: paymentStatusFor(received, num(inv.total)) } });
      await tx.receiptAllocation.create({ data: { receiptId: receipt.id, customerInvoiceId: inv.id, amount } });
    } else {
      const inv = await tx.salesInvoice.findUnique({ where: { id: a.invoiceId } });
      if (!inv || inv.buyerId !== receipt.buyerId || inv.status !== "POSTED") throw new AppError("An allocated invoice is invalid for this buyer.");
      const balance = round2(num(inv.total) - num(inv.amountReceived));
      if (amount > balance) throw new AppError(`Allocation of ${amount} exceeds the balance ${balance} on invoice ${inv.number}.`);
      const received = round2(num(inv.amountReceived) + amount);
      await tx.salesInvoice.update({ where: { id: inv.id }, data: { amountReceived: received, paymentStatus: paymentStatusFor(received, num(inv.total)) } });
      await tx.receiptAllocation.create({ data: { receiptId: receipt.id, salesInvoiceId: inv.id, amount } });
    }
    total = round2(total + amount);
  }
  return total;
}

export async function createReceipt(ctx: Ctx, input: unknown) {
  assertCan(ctx, "receipts.manage");
  const i = receiptSchema.parse(input);
  const allocTotal = round2(i.allocations.reduce((s, a) => s + a.amount, 0));
  if (allocTotal > round2(i.amount)) throw new AppError(`Allocated amount ${allocTotal} exceeds the receipt amount ${i.amount}.`);
  return prisma.$transaction(async (tx) => {
    const acc = await cashBankAccount(tx, i.accountId);
    const party =
      i.partyType === "CUSTOMER"
        ? await tx.customer.findUnique({ where: { id: i.customerId! } })
        : await tx.buyer.findUnique({ where: { id: i.buyerId! } });
    if (!party) throw new AppError("Party not found.");
    const date = dateOnly(i.date);
    const number = await nextNumber(tx, "RECEIPT", date);
    const r = await tx.receipt.create({
      data: {
        number,
        date,
        partyType: i.partyType,
        customerId: i.partyType === "CUSTOMER" ? party.id : null,
        buyerId: i.partyType === "BUYER" ? party.id : null,
        amount: i.amount,
        mode: i.mode,
        accountId: acc.id,
        reference: i.reference ?? null,
        remarks: i.remarks ?? null,
        createdById: ctx.userId,
      },
    });
    const allocated = await applyAllocations(tx, r, i.allocations);
    await tx.receipt.update({ where: { id: r.id }, data: { allocatedAmount: allocated } });
    await postJournal(tx, ctx, {
      date,
      narration: `Receipt ${number} from ${party.name} (${i.mode.replace("_", " ").toLowerCase()})`,
      sourceType: "RECEIPT",
      sourceId: r.id,
      sourceNumber: number,
      lines: [
        { accountId: acc.id, debit: i.amount },
        {
          accountCode: i.partyType === "CUSTOMER" ? ACC.AR_CUSTOMERS : ACC.AR_BUYERS,
          credit: i.amount,
          partyType: i.partyType,
          partyId: party.id,
        },
      ],
    });
    await audit(tx, ctx, { action: "CREATE", module: "receipts", recordId: r.id, recordLabel: `${number} ${party.name}`, newValues: { amount: i.amount, allocations: i.allocations } });
    return r;
  });
}

/** Allocate the unallocated (advance) balance of an existing receipt to invoices. */
export async function allocateReceipt(ctx: Ctx, input: unknown) {
  assertCan(ctx, "receipts.manage");
  const i = receiptAllocateSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const r = await tx.receipt.findUnique({ where: { id: i.receiptId } });
    if (!r || r.status !== "POSTED") throw new AppError("Receipt not found.");
    const available = round2(num(r.amount) - num(r.allocatedAmount));
    const want = round2(i.allocations.reduce((s, a) => s + a.amount, 0));
    if (want > available) throw new AppError(`Only ${available} is available to allocate on this receipt.`);
    const allocated = await applyAllocations(tx, r, i.allocations);
    await tx.receipt.update({ where: { id: r.id }, data: { allocatedAmount: round2(num(r.allocatedAmount) + allocated) } });
    await audit(tx, ctx, { action: "ALLOCATE", module: "receipts", recordId: r.id, recordLabel: r.number, newValues: { allocations: i.allocations } });
    return r;
  });
}

export async function cancelReceipt(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "receipts.manage");
  if (!reason || reason.trim().length < 3) throw new AppError("Enter a cancellation reason.");
  return prisma.$transaction(async (tx) => {
    const r = await tx.receipt.findUnique({ where: { id }, include: { allocations: true } });
    if (!r || r.status === "CANCELLED") throw new AppError("Receipt not found or already cancelled.");
    for (const a of r.allocations) {
      if (a.customerInvoiceId) {
        const inv = await tx.customerInvoice.findUniqueOrThrow({ where: { id: a.customerInvoiceId } });
        const received = round2(num(inv.amountReceived) - num(a.amount));
        await tx.customerInvoice.update({ where: { id: inv.id }, data: { amountReceived: received, paymentStatus: paymentStatusFor(received, num(inv.total)) } });
      }
      if (a.salesInvoiceId) {
        const inv = await tx.salesInvoice.findUniqueOrThrow({ where: { id: a.salesInvoiceId } });
        const received = round2(num(inv.amountReceived) - num(a.amount));
        await tx.salesInvoice.update({ where: { id: inv.id }, data: { amountReceived: received, paymentStatus: paymentStatusFor(received, num(inv.total)) } });
      }
    }
    await reverseJournal(tx, ctx, "RECEIPT", r.id, dateOnly(todayISO()), reason);
    const u = await tx.receipt.update({ where: { id }, data: { status: "CANCELLED", cancelReason: reason } });
    await audit(tx, ctx, { action: "CANCEL", module: "receipts", recordId: id, recordLabel: r.number, oldValues: { status: r.status, amount: r.amount }, newValues: { status: "CANCELLED", reason } });
    return u;
  });
}

// ----------------------------- SUPPLIER PAYMENTS ------------------------

export async function createPayment(ctx: Ctx, input: unknown) {
  assertCan(ctx, "receipts.manage");
  const i = paymentSchema.parse(input);
  const allocTotal = round2(i.allocations.reduce((s, a) => s + a.amount, 0));
  if (allocTotal > round2(i.amount)) throw new AppError(`Allocated amount ${allocTotal} exceeds the payment amount ${i.amount}.`);
  return prisma.$transaction(async (tx) => {
    const acc = await cashBankAccount(tx, i.accountId);
    const supplier = await tx.supplier.findUnique({ where: { id: i.supplierId } });
    if (!supplier) throw new AppError("Supplier not found.");
    const date = dateOnly(i.date);
    const number = await nextNumber(tx, "PAYMENT", date);
    const p = await tx.payment.create({
      data: {
        number,
        date,
        supplierId: supplier.id,
        amount: i.amount,
        mode: i.mode,
        accountId: acc.id,
        reference: i.reference ?? null,
        remarks: i.remarks ?? null,
        createdById: ctx.userId,
      },
    });
    for (const a of i.allocations) {
      const amount = round2(a.amount);
      if (a.docType === "PURCHASE") {
        const doc = await tx.purchase.findUnique({ where: { id: a.docId } });
        if (!doc || doc.supplierId !== supplier.id || doc.status !== "POSTED") throw new AppError("Invalid purchase bill in allocation.");
        const balance = round2(num(doc.total) - num(doc.amountPaid));
        if (amount > balance) throw new AppError(`Allocation exceeds the balance ${balance} on ${doc.number}.`);
        const paid = round2(num(doc.amountPaid) + amount);
        await tx.purchase.update({ where: { id: doc.id }, data: { amountPaid: paid, paymentStatus: paymentStatusFor(paid, num(doc.total)) } });
        await tx.paymentAllocation.create({ data: { paymentId: p.id, purchaseId: doc.id, amount } });
      } else {
        const doc = await tx.expense.findUnique({ where: { id: a.docId } });
        if (!doc || doc.supplierId !== supplier.id || doc.status !== "POSTED" || doc.paymentMode !== "CREDIT") throw new AppError("Invalid expense bill in allocation.");
        const balance = round2(num(doc.total) - num(doc.amountPaid));
        if (amount > balance) throw new AppError(`Allocation exceeds the balance ${balance} on ${doc.number}.`);
        const paid = round2(num(doc.amountPaid) + amount);
        await tx.expense.update({ where: { id: doc.id }, data: { amountPaid: paid, paymentStatus: paymentStatusFor(paid, num(doc.total)) } });
        await tx.paymentAllocation.create({ data: { paymentId: p.id, expenseId: doc.id, amount } });
      }
    }
    await postJournal(tx, ctx, {
      date,
      narration: `Payment ${number} to ${supplier.name}`,
      sourceType: "PAYMENT",
      sourceId: p.id,
      sourceNumber: number,
      lines: [
        { accountCode: ACC.AP_SUPPLIERS, debit: i.amount, partyType: "SUPPLIER", partyId: supplier.id },
        { accountId: acc.id, credit: i.amount },
      ],
    });
    await audit(tx, ctx, { action: "CREATE", module: "receipts", recordId: p.id, recordLabel: `${number} ${supplier.name}`, newValues: { amount: i.amount, allocations: i.allocations } });
    return p;
  });
}

export async function cancelPayment(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "receipts.manage");
  if (!reason || reason.trim().length < 3) throw new AppError("Enter a cancellation reason.");
  return prisma.$transaction(async (tx) => {
    const p = await tx.payment.findUnique({ where: { id }, include: { allocations: true } });
    if (!p || p.status === "CANCELLED") throw new AppError("Payment not found or already cancelled.");
    for (const a of p.allocations) {
      if (a.purchaseId) {
        const doc = await tx.purchase.findUniqueOrThrow({ where: { id: a.purchaseId } });
        const paid = round2(num(doc.amountPaid) - num(a.amount));
        await tx.purchase.update({ where: { id: doc.id }, data: { amountPaid: paid, paymentStatus: paymentStatusFor(paid, num(doc.total)) } });
      }
      if (a.expenseId) {
        const doc = await tx.expense.findUniqueOrThrow({ where: { id: a.expenseId } });
        const paid = round2(num(doc.amountPaid) - num(a.amount));
        await tx.expense.update({ where: { id: doc.id }, data: { amountPaid: paid, paymentStatus: paymentStatusFor(paid, num(doc.total)) } });
      }
    }
    await reverseJournal(tx, ctx, "PAYMENT", p.id, dateOnly(todayISO()), reason);
    const u = await tx.payment.update({ where: { id }, data: { status: "CANCELLED", cancelReason: reason } });
    await audit(tx, ctx, { action: "CANCEL", module: "receipts", recordId: id, recordLabel: p.number, oldValues: { status: p.status }, newValues: { status: "CANCELLED", reason } });
    return u;
  });
}
