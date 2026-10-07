import { prisma } from "@/lib/db";
import { addDays, dateOnly, num, todayISO } from "@/lib/utils";
import { salesInvoiceSchema } from "@/lib/validation";
import { ACC, postJournal, reverseJournal } from "../accounting";
import { audit } from "../audit";
import { assertCan, type Ctx } from "../context";
import { AppError } from "../errors";
import { computeTax, getGstContext, roundOffTotal, sumTaxes } from "../gst";
import { postStock, reverseStock } from "../inventory";
import { nextNumber } from "../numbering";

/**
 * Recyclable material sale. Invoice, stock reduction and accounting entry are written in ONE
 * database transaction: if stock is insufficient (or anything else fails) nothing is saved.
 */
export async function createSalesInvoice(ctx: Ctx, input: unknown) {
  assertCan(ctx, "sales.manage");
  const i = salesInvoiceSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const buyer = await tx.buyer.findUnique({ where: { id: i.buyerId } });
    if (!buyer || buyer.status !== "ACTIVE") throw new AppError("Select an active buyer.", { buyerId: "Invalid buyer" });
    const gst = await getGstContext(tx);
    const items = await tx.inventoryItem.findMany({ where: { id: { in: i.items.map((l) => l.itemId) } } });
    const byId = new Map(items.map((x) => [x.id, x]));
    const interState = gst.isInterState(buyer.gstin, buyer.stateCode);
    const lines = i.items.map((l) => {
      const it = byId.get(l.itemId);
      if (!it || !it.isSaleable) throw new AppError("Only saleable recovered materials can be sold.");
      const rate = l.gstRate ?? (it.gstRateId ? gst.rateById.get(it.gstRateId) ?? 0 : gst.defaultGoodsRate);
      return { l, it, tax: computeTax(l.quantity * l.rate, rate, interState, gst.gstEnabled) };
    });
    const totals = sumTaxes(lines.map((x) => x.tax));
    const { total, roundOff } = roundOffTotal(totals.gross, gst.roundOff);
    const date = dateOnly(i.date);
    const number = await nextNumber(tx, "SALES_INVOICE", date);
    const inv = await tx.salesInvoice.create({
      data: {
        number,
        date,
        buyerId: buyer.id,
        locationId: i.locationId,
        isInterState: interState,
        placeOfSupply: buyer.stateCode ?? gst.companyState,
        vehicleNumber: i.vehicleNumber ?? null,
        subtotal: totals.subtotal,
        cgst: totals.cgst,
        sgst: totals.sgst,
        igst: totals.igst,
        roundOff,
        total,
        dueDate: addDays(date, buyer.paymentTermsDays),
        remarks: i.remarks ?? null,
        createdById: ctx.userId,
        items: {
          create: lines.map(({ l, it, tax }) => ({
            itemId: it.id,
            description: it.name,
            hsnCode: it.hsnCode,
            quantity: l.quantity,
            unit: it.unit,
            rate: l.rate,
            ...tax,
          })),
        },
      },
    });
    for (const { l, it } of lines) {
      await postStock(tx, ctx, {
        date,
        itemId: it.id,
        locationId: i.locationId,
        quantity: -l.quantity,
        txnType: "SALE",
        rate: l.rate,
        refType: "SALES_INVOICE",
        refId: inv.id,
        refNumber: number,
        remarks: `Sold to ${buyer.name}`,
      });
    }
    await postJournal(tx, ctx, {
      date,
      narration: `Recyclable sale ${number} - ${buyer.name}`,
      sourceType: "SALES_INVOICE",
      sourceId: inv.id,
      sourceNumber: number,
      lines: [
        { accountCode: ACC.AR_BUYERS, debit: total, partyType: "BUYER", partyId: buyer.id },
        { accountCode: ACC.RECYCLABLE_SALES, credit: totals.subtotal },
        { accountCode: ACC.GST_OUT_CGST, credit: totals.cgst },
        { accountCode: ACC.GST_OUT_SGST, credit: totals.sgst },
        { accountCode: ACC.GST_OUT_IGST, credit: totals.igst },
        { accountCode: ACC.ROUND_OFF, credit: roundOff },
      ],
    });
    await audit(tx, ctx, { action: "CREATE", module: "sales", recordId: inv.id, recordLabel: `${number} ${buyer.name}`, newValues: { number, total, items: i.items } });
    return inv;
  });
}

export async function cancelSalesInvoice(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "sales.manage");
  if (!reason || reason.trim().length < 3) throw new AppError("Enter a cancellation reason.");
  return prisma.$transaction(async (tx) => {
    const inv = await tx.salesInvoice.findUnique({ where: { id } });
    if (!inv || inv.status === "CANCELLED") throw new AppError("Sale not found or already cancelled.");
    if (num(inv.amountReceived) > 0) throw new AppError("Receipts are allocated to this sale. Cancel them first.");
    await reverseStock(tx, ctx, "SALES_INVOICE", inv.id, reason);
    await reverseJournal(tx, ctx, "SALES_INVOICE", inv.id, dateOnly(todayISO()), reason);
    const u = await tx.salesInvoice.update({ where: { id }, data: { status: "CANCELLED", cancelReason: reason } });
    await audit(tx, ctx, { action: "CANCEL", module: "sales", recordId: id, recordLabel: inv.number, oldValues: { status: inv.status }, newValues: { status: "CANCELLED", reason } });
    return u;
  });
}
