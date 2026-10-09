import { z } from "zod";
import { prisma, type Tx } from "../db.js";
import { assertCan, type Ctx } from "../context.js";
import { audit } from "../audit.js";
import { nextCode, nextNumber } from "../sequence.js";
import { badRequest, notFound } from "../lib/errors.js";
import { parse, optStr, money, optId, reqId, isoDate, optDate } from "../lib/validate.js";
import { plain, pageParams, toDate } from "../lib/util.js";
import { computeGst, financialYear, num, round2, addDays, displayDate, type GstType } from "../../shared/calc.js";

const invoiceSchema = z.object({
  customerId: reqId,
  invoiceDate: isoDate,
  dueDate: optDate,
  tripIds: z.array(z.string().uuid()).min(1, "select at least one trip").max(500),
  otherCharges: money,
  otherChargesLabel: optStr(100),
  gstType: z.enum(["NONE", "CGST_SGST", "IGST", "RCM"]),
  gstRate: z.preprocess((v) => (v === "" || v == null ? 0 : Number(v)), z.number().min(0).max(28)),
  placeOfSupply: optStr(60),
  sacCode: optStr(10),
  notes: optStr(1000),
});

const receiptSchema = z.object({
  customerId: reqId,
  invoiceId: optId,
  receiptDate: isoDate,
  amount: money.refine((n) => n > 0, "must be more than zero"),
  tdsAmount: money,
  mode: z.enum(["CASH", "BANK", "UPI", "CHEQUE", "NEFT", "RTGS"]).default("BANK"),
  reference: optStr(100),
  notes: optStr(500),
});

export async function invoiceReceived(db: Tx | typeof prisma, invoiceIds: string[]) {
  if (!invoiceIds.length) return new Map<string, number>();
  const g = await db.customerReceipt.groupBy({ by: ["invoiceId"], where: { invoiceId: { in: invoiceIds }, status: "ACTIVE" }, _sum: { amount: true, tdsAmount: true } });
  return new Map(g.map((x) => [x.invoiceId!, round2(num(x._sum.amount) + num(x._sum.tdsAmount))]));
}

export function payState(total: number, received: number, status: string) {
  if (status === "CANCELLED") return "CANCELLED";
  if (received <= 0) return "UNPAID";
  if (received + 0.005 >= total) return "PAID";
  return "PARTIAL";
}

export async function listInvoices(ctx: Ctx, q: any) {
  assertCan(ctx, "billing.view");
  const { skip, take, page, pageSize } = pageParams(q);
  const where: any = {};
  if (q.customerId) where.customerId = q.customerId;
  if (q.status) where.status = q.status;
  if (q.from || q.to) where.invoiceDate = { ...(q.from ? { gte: toDate(q.from) } : {}), ...(q.to ? { lte: toDate(q.to) } : {}) };
  if (q.q) where.OR = [{ invoiceNumber: { contains: q.q, mode: "insensitive" } }, { customer: { name: { contains: q.q, mode: "insensitive" } } }];
  const [rows, total] = await Promise.all([
    prisma.customerInvoice.findMany({ where, skip, take, orderBy: [{ invoiceDate: "desc" }, { invoiceNumber: "desc" }], include: { customer: { select: { id: true, name: true } }, _count: { select: { items: true } } } }),
    prisma.customerInvoice.count({ where }),
  ]);
  const rec = await invoiceReceived(prisma, rows.map((r) => r.id));
  return {
    rows: rows.map((r) => {
      const received = rec.get(r.id) ?? 0;
      const totalAmt = num(r.total);
      return { ...plain(r), received, balance: r.status === "CANCELLED" ? 0 : round2(totalAmt - received), payState: payState(totalAmt, received, r.status) };
    }),
    total, page, pageSize,
  };
}

export async function getInvoice(ctx: Ctx, id: string) {
  assertCan(ctx, "billing.view");
  const inv = await prisma.customerInvoice.findUnique({
    where: { id },
    include: {
      customer: true,
      items: { orderBy: { lineNo: "asc" }, include: { trip: { include: { vehicle: { select: { vehicleNumber: true } }, loadingPoint: { select: { name: true } }, deliveryPoint: { select: { name: true } } } } } },
      receipts: { orderBy: { receiptDate: "asc" } },
    },
  });
  if (!inv) throw notFound("Invoice not found.");
  const received = inv.receipts.filter((r) => r.status === "ACTIVE").reduce((a, r) => a + num(r.amount) + num(r.tdsAmount), 0);
  const company = await prisma.company.findFirst();
  return { ...plain(inv), company: plain(company), received: round2(received), balance: inv.status === "CANCELLED" ? 0 : round2(num(inv.total) - received), payState: payState(num(inv.total), received, inv.status) };
}

/** Trips that can be billed to a customer: not cancelled and not already on an active invoice. */
export async function billableTrips(ctx: Ctx, customerId: string) {
  assertCan(ctx, "billing.view");
  const trips = await prisma.trip.findMany({
    where: { customerId, status: { not: "CANCELLED" }, invoiceItems: { none: { invoice: { status: { not: "CANCELLED" } } } } },
    orderBy: [{ tripDate: "asc" }, { tripNumber: "asc" }],
    include: { vehicle: { select: { vehicleNumber: true } }, loadingPoint: { select: { name: true } }, deliveryPoint: { select: { name: true } } },
  });
  return plain(trips);
}

export async function createInvoice(ctx: Ctx, body: unknown) {
  assertCan(ctx, "billing.edit");
  const input = parse(invoiceSchema, body);
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
    if (!customer) throw badRequest("Customer not found.");
    const trips = await tx.trip.findMany({
      where: { id: { in: input.tripIds } },
      include: { vehicle: true, loadingPoint: true, deliveryPoint: true, invoiceItems: { include: { invoice: true } } },
      orderBy: [{ tripDate: "asc" }, { tripNumber: "asc" }],
    });
    if (trips.length !== new Set(input.tripIds).size) throw badRequest("Some trips were not found.");
    for (const t of trips) {
      if (t.customerId !== input.customerId) throw badRequest(`Trip ${t.tripNumber} belongs to another customer.`);
      if (t.status === "CANCELLED") throw badRequest(`Trip ${t.tripNumber} is cancelled.`);
      const billed = t.invoiceItems.find((i) => i.invoice.status !== "CANCELLED");
      if (billed) throw badRequest(`Trip ${t.tripNumber} is already billed in ${billed.invoice.invoiceNumber}.`);
    }
    const company = await tx.company.findFirst();
    const fy = financialYear(input.invoiceDate);
    const series = `${company?.invoicePrefix || "INV"}/${fy.label}`;
    const invoiceNumber = `${series}/${String(await nextNumber(tx, `INV:${series}`)).padStart(4, "0")}`;
    const freight = round2(trips.reduce((a, t) => a + num(t.customerFreight), 0));
    const taxable = round2(freight + input.otherCharges);
    const gst = computeGst(taxable, input.gstType as GstType, input.gstType === "NONE" ? 0 : input.gstRate);
    const dueDate = input.dueDate ?? addDays(input.invoiceDate, customer.creditDays);
    const inv = await tx.customerInvoice.create({
      data: {
        invoiceNumber, invoiceDate: toDate(input.invoiceDate)!, dueDate: toDate(dueDate), customerId: input.customerId,
        freightAmount: freight, otherCharges: input.otherCharges, taxableValue: gst.taxable, gstType: input.gstType,
        gstRate: input.gstType === "NONE" ? 0 : input.gstRate, cgst: gst.cgst, sgst: gst.sgst, igst: gst.igst, roundOff: gst.roundOff, total: gst.total,
        placeOfSupply: input.placeOfSupply ?? customer.state, notes: input.notes, createdBy: ctx.user.name,
      },
    });
    const items = trips.map((t, i) => ({
      invoiceId: inv.id, tripId: t.id, lineNo: i + 1, sacCode: input.sacCode ?? "996791", amount: t.customerFreight,
      description: [`Freight ${t.tripNumber} dt ${displayDate(t.tripDate.toISOString())}`, t.loadingPoint && t.deliveryPoint ? `${t.loadingPoint.name} to ${t.deliveryPoint.name}` : null,
        t.vehicle ? `Vehicle ${t.vehicle.vehicleNumber}` : null, t.lrNumber ? `LR ${t.lrNumber}` : null, t.material].filter(Boolean).join(", "),
    }));
    if (input.otherCharges > 0) items.push({ invoiceId: inv.id, tripId: null as any, lineNo: items.length + 1, sacCode: input.sacCode ?? "996791", amount: input.otherCharges as any, description: input.otherChargesLabel ?? "Other charges" });
    await tx.invoiceItem.createMany({ data: items });
    await tx.trip.updateMany({ where: { id: { in: input.tripIds }, status: { in: ["BOOKED", "ALLOCATED", "LOADED", "IN TRANSIT", "DELIVERED", "POD RECEIVED"] } }, data: { status: "BILLED" } });
    await audit(tx, ctx, "INVOICE", { type: "INVOICE", id: inv.id, code: invoiceNumber }, null, { ...inv, trips: trips.map((t) => t.tripNumber) });
    return plain(inv);
  });
}

export async function cancelInvoice(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "billing.edit");
  if (!reason || reason.trim().length < 3) throw badRequest("A cancel reason is required.");
  return prisma.$transaction(async (tx) => {
    const inv = await tx.customerInvoice.findUnique({ where: { id }, include: { receipts: { where: { status: "ACTIVE" } }, items: true } });
    if (!inv) throw notFound();
    if (inv.status === "CANCELLED") throw badRequest("Invoice is already cancelled.");
    if (inv.receipts.length) throw badRequest("Invoice has receipts. Cancel the receipts first.");
    const updated = await tx.customerInvoice.update({ where: { id }, data: { status: "CANCELLED", notes: `${inv.notes ? inv.notes + "\n" : ""}CANCELLED: ${reason.trim()}` } });
    const tripIds = inv.items.map((i) => i.tripId).filter(Boolean) as string[];
    const trips = await tx.trip.findMany({ where: { id: { in: tripIds }, status: "BILLED" } });
    for (const t of trips) await tx.trip.update({ where: { id: t.id }, data: { status: t.podReceivedDate ? "POD RECEIVED" : "DELIVERED" } });
    await audit(tx, ctx, "CANCEL", { type: "INVOICE", id, code: inv.invoiceNumber }, { status: inv.status }, { status: "CANCELLED", reason });
    return plain(updated);
  });
}

export async function listReceipts(ctx: Ctx, q: any) {
  assertCan(ctx, "billing.view");
  const { skip, take, page, pageSize } = pageParams(q);
  const where: any = {};
  if (q.customerId) where.customerId = q.customerId;
  if (q.invoiceId) where.invoiceId = q.invoiceId;
  if (q.from || q.to) where.receiptDate = { ...(q.from ? { gte: toDate(q.from) } : {}), ...(q.to ? { lte: toDate(q.to) } : {}) };
  if (q.q) where.OR = [{ code: { contains: q.q, mode: "insensitive" } }, { reference: { contains: q.q, mode: "insensitive" } }, { customer: { name: { contains: q.q, mode: "insensitive" } } }];
  const [rows, total] = await Promise.all([
    prisma.customerReceipt.findMany({ where, skip, take, orderBy: [{ receiptDate: "desc" }, { code: "desc" }], include: { customer: { select: { id: true, name: true } }, invoice: { select: { id: true, invoiceNumber: true } } } }),
    prisma.customerReceipt.count({ where }),
  ]);
  return { rows: plain(rows), total, page, pageSize };
}

export async function createReceipt(ctx: Ctx, body: unknown) {
  assertCan(ctx, "billing.edit");
  const input = parse(receiptSchema, body);
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
    if (!customer) throw badRequest("Customer not found.");
    if (input.invoiceId) {
      const inv = await tx.customerInvoice.findUnique({ where: { id: input.invoiceId } });
      if (!inv || inv.customerId !== input.customerId) throw badRequest("Invoice does not belong to this customer.");
      if (inv.status === "CANCELLED") throw badRequest("Invoice is cancelled.");
      const received = (await invoiceReceived(tx, [inv.id])).get(inv.id) ?? 0;
      const balance = round2(num(inv.total) - received);
      if (input.amount + input.tdsAmount > balance + 0.005) throw badRequest(`Amount + TDS (${round2(input.amount + input.tdsAmount)}) is more than the invoice balance (${balance}).`);
    }
    const code = await nextCode(tx, "RCP");
    const r = await tx.customerReceipt.create({ data: { ...input, receiptDate: toDate(input.receiptDate)!, code, createdBy: ctx.user.name } });
    await audit(tx, ctx, "PAYMENT", { type: "RECEIPT", id: r.id, code }, null, r);
    return plain(r);
  });
}

export async function cancelReceipt(ctx: Ctx, id: string) {
  assertCan(ctx, "billing.edit");
  return prisma.$transaction(async (tx) => {
    const r = await tx.customerReceipt.findUnique({ where: { id } });
    if (!r) throw notFound();
    if (r.status === "CANCELLED") throw badRequest("Already cancelled.");
    const u = await tx.customerReceipt.update({ where: { id }, data: { status: "CANCELLED" } });
    await audit(tx, ctx, "CANCEL", { type: "RECEIPT", id, code: r.code }, { status: r.status }, { status: "CANCELLED" });
    return plain(u);
  });
}
