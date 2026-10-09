import { z } from "zod";
import { prisma, type Tx } from "../db.js";
import { assertCan, type Ctx } from "../context.js";
import { audit } from "../audit.js";
import { nextCode } from "../sequence.js";
import { badRequest, notFound } from "../lib/errors.js";
import { parse, optStr, money, optNum, optDate, optId, reqId, isoDate, dates } from "../lib/validate.js";
import { plain, pageParams, toDate } from "../lib/util.js";
import { TRIP_STATUSES, tripProfit, num, round2 } from "../../shared/calc.js";

const item = z.object({
  description: optStr(300), material: optStr(120), packages: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().min(0).nullable()).optional(),
  quantity: optNum, unit: optStr(20), weightTons: optNum, invoiceRef: optStr(60), value: optNum,
});

export const tripSchema = z.object({
  tripDate: isoDate,
  customerId: reqId,
  transporterId: optId, vehicleId: optId, driverId: optId, loadingPointId: optId, deliveryPointId: optId,
  material: optStr(150), quantity: optNum, unit: optStr(20), weightTons: optNum, distanceKm: optNum,
  lrNumber: optStr(40), lrDate: optDate, ewayBillNumber: optStr(20), ewayBillExpiry: optDate,
  customerFreight: money, transporterHire: money, loadingCharges: money, unloadingCharges: money, diesel: money, toll: money,
  rto: money, driverBata: money, otherExpense: money, advance: money,
  status: z.enum(TRIP_STATUSES).default("BOOKED"),
  remarks: optStr(1000),
  items: z.array(item).max(50).optional(),
});

const DATE_KEYS = ["tripDate", "lrDate", "ewayBillExpiry"];
const LIST_INCLUDE = {
  customer: { select: { id: true, name: true } },
  transporter: { select: { id: true, name: true } },
  vehicle: { select: { id: true, vehicleNumber: true } },
  driver: { select: { id: true, name: true, mobile: true } },
  loadingPoint: { select: { id: true, name: true } },
  deliveryPoint: { select: { id: true, name: true } },
};

/** Sum of active expense entries linked to each trip (they count in the trip's profit). */
export async function linkedExpenses(db: Tx | typeof prisma, tripIds: string[]) {
  if (!tripIds.length) return new Map<string, number>();
  const g = await db.expense.groupBy({ by: ["tripId"], where: { tripId: { in: tripIds }, status: "ACTIVE" }, _sum: { amount: true } });
  return new Map(g.map((x) => [x.tripId!, num(x._sum.amount)]));
}

export function tripWhere(q: any) {
  const where: any = {};
  if (q.status) where.status = { in: String(q.status).split(",") };
  if (q.activeOnly === "1") where.status = { in: ["BOOKED", "ALLOCATED", "LOADED", "IN TRANSIT"] };
  for (const k of ["customerId", "transporterId", "vehicleId", "driverId", "loadingPointId", "deliveryPointId"]) if (q[k]) where[k] = q[k];
  if (q.from || q.to) where.tripDate = { ...(q.from ? { gte: toDate(q.from) } : {}), ...(q.to ? { lte: toDate(q.to) } : {}) };
  const term = String(q.q ?? "").trim();
  if (term) {
    where.OR = [
      { tripNumber: { contains: term, mode: "insensitive" } }, { lrNumber: { contains: term, mode: "insensitive" } },
      { ewayBillNumber: { contains: term, mode: "insensitive" } }, { material: { contains: term, mode: "insensitive" } },
      { vehicle: { vehicleNumber: { contains: term.replace(/[\s-]/g, ""), mode: "insensitive" } } },
      { customer: { name: { contains: term, mode: "insensitive" } } }, { transporter: { name: { contains: term, mode: "insensitive" } } },
      { driver: { name: { contains: term, mode: "insensitive" } } },
    ];
  }
  if (q.billed === "0") where.invoiceItems = { none: { invoice: { status: { not: "CANCELLED" } } } };
  return where;
}

export async function listTrips(ctx: Ctx, q: any) {
  assertCan(ctx, "trips.view");
  const { skip, take, page, pageSize } = pageParams(q);
  const where = tripWhere(q);
  const [rows, total] = await Promise.all([
    prisma.trip.findMany({ where, skip, take, orderBy: [{ tripDate: "desc" }, { tripNumber: "desc" }], include: LIST_INCLUDE }),
    prisma.trip.count({ where }),
  ]);
  const linked = await linkedExpenses(prisma, rows.map((r) => r.id));
  const showProfit = ctx.permissions.has("profit.view");
  return {
    rows: rows.map((r) => {
      const p = tripProfit(plain(r), linked.get(r.id) ?? 0);
      return { ...plain(r), profit: showProfit ? p.profit : null, totalCost: showProfit ? p.totalCost : null, hireBalance: p.hireBalance };
    }),
    total, page, pageSize,
  };
}

export async function getTrip(ctx: Ctx, id: string) {
  assertCan(ctx, "trips.view");
  const t = await prisma.trip.findUnique({
    where: { id },
    include: {
      ...LIST_INCLUDE,
      items: { orderBy: { lineNo: "asc" } },
      expenses: { orderBy: { expenseDate: "asc" } },
      settlement: { include: { payments: { orderBy: { paymentDate: "asc" } } } },
      invoiceItems: { include: { invoice: { select: { id: true, invoiceNumber: true, invoiceDate: true, status: true } } } },
    },
  });
  if (!t) throw notFound("Trip not found.");
  const linked = t.expenses.filter((e) => e.status === "ACTIVE").reduce((a, e) => a + num(e.amount), 0);
  const documents = await prisma.document.findMany({ where: { entityType: "TRIP", entityId: id }, orderBy: { createdAt: "desc" } });
  const p = plain(t);
  return { ...p, documents: plain(documents), profitDetail: ctx.permissions.has("profit.view") ? tripProfit(p, linked) : null };
}

async function activeInvoiceFor(tx: Tx, tripId: string) {
  return tx.invoiceItem.findFirst({ where: { tripId, invoice: { status: { not: "CANCELLED" } } }, include: { invoice: true } });
}

/** Keep the transporter settlement in step with the trip (one settlement per trip with a transporter). */
async function syncSettlement(tx: Tx, ctx: Ctx, trip: { id: string; transporterId: string | null; status: string; transporterHire: any; advance: any }) {
  const s = await tx.transporterSettlement.findUnique({ where: { tripId: trip.id }, include: { payments: { where: { status: "ACTIVE" } } } });
  const paid = s ? s.payments.reduce((a, p) => a + num(p.amount), 0) : 0;
  const wantOpen = !!trip.transporterId && trip.status !== "CANCELLED";
  if (!s) {
    if (!wantOpen) return;
    const code = await nextCode(tx, "STL");
    const created = await tx.transporterSettlement.create({ data: { code, tripId: trip.id, transporterId: trip.transporterId!, status: "PENDING" } });
    await audit(tx, ctx, "CREATE", { type: "SETTLEMENT", id: created.id, code }, null, created);
    return;
  }
  if (!wantOpen) {
    if (paid > 0) throw badRequest(`Settlement ${s.code} already has payments of ${paid}. Cancel those payments first.`);
    if (s.status !== "CANCELLED") await tx.transporterSettlement.update({ where: { id: s.id }, data: { status: "CANCELLED" } });
    return;
  }
  if (s.transporterId !== trip.transporterId && paid > 0) throw badRequest(`Transporter cannot be changed: settlement ${s.code} already has payments.`);
  const balance = round2(num(trip.transporterHire) - num(trip.advance) - num(s.deductions) - paid);
  if (balance < 0) throw badRequest(`Hire is less than advance + deductions + payments already made (balance would be ${balance}).`);
  const status = balance === 0 && num(trip.transporterHire) > 0 ? "PAID" : paid > 0 ? "PARTIAL" : "PENDING";
  await tx.transporterSettlement.update({ where: { id: s.id }, data: { transporterId: trip.transporterId!, status } });
}

export async function saveTrip(ctx: Ctx, body: unknown, id?: string) {
  assertCan(ctx, "trips.edit");
  const input = parse(tripSchema, body);
  if (input.advance > input.transporterHire) throw badRequest("Advance cannot be more than the transporter hire.");
  const { items, ...rest } = input;
  const data: any = dates(rest, DATE_KEYS);
  return prisma.$transaction(async (tx) => {
    let trip;
    if (id) {
      const old = await tx.trip.findUnique({ where: { id } });
      if (!old) throw notFound("Trip not found.");
      if (old.status === "CANCELLED") throw badRequest("A cancelled trip cannot be edited.");
      if (data.status === "CANCELLED") throw badRequest("Use Cancel Trip to cancel (a reason is required).");
      const inv = await activeInvoiceFor(tx, id);
      if (inv && (num(old.customerFreight) !== data.customerFreight || old.customerId !== data.customerId)) {
        throw badRequest(`Trip is billed in invoice ${inv.invoice.invoiceNumber}. Cancel the invoice before changing customer or freight.`);
      }
      if (data.status === "DELIVERED" && !old.deliveredDate) data.deliveredDate = new Date(`${input.tripDate}T00:00:00Z`);
      trip = await tx.trip.update({ where: { id }, data });
      if (items) {
        await tx.tripItem.deleteMany({ where: { tripId: id } });
        if (items.length) await tx.tripItem.createMany({ data: items.map((it, i) => ({ ...it, tripId: id, lineNo: i + 1 })) });
      }
      await audit(tx, ctx, "EDIT", { type: "TRIP", id, code: trip.tripNumber }, old, trip);
    } else {
      if (data.status === "CANCELLED") throw badRequest("A new trip cannot be cancelled.");
      const tripNumber = await nextCode(tx, "TRP");
      trip = await tx.trip.create({ data: { ...data, tripNumber, createdBy: ctx.user.name } });
      if (items?.length) await tx.tripItem.createMany({ data: items.map((it, i) => ({ ...it, tripId: trip!.id, lineNo: i + 1 })) });
      await audit(tx, ctx, "CREATE", { type: "TRIP", id: trip.id, code: tripNumber }, null, trip);
    }
    await syncSettlement(tx, ctx, trip);
    return plain(trip);
  });
}

const FLOW = ["BOOKED", "ALLOCATED", "LOADED", "IN TRANSIT", "DELIVERED", "POD RECEIVED", "BILLED", "SETTLED", "CLOSED"];

export async function setTripStatus(ctx: Ctx, id: string, body: any) {
  assertCan(ctx, "trips.edit");
  const status = String(body?.status ?? "");
  const date = body?.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : new Date().toISOString().slice(0, 10);
  if (!FLOW.includes(status)) throw badRequest("Unknown status.");
  return prisma.$transaction(async (tx) => {
    const old = await tx.trip.findUnique({ where: { id } });
    if (!old) throw notFound("Trip not found.");
    if (old.status === "CANCELLED") throw badRequest("Trip is cancelled.");
    const data: any = { status };
    if (status === "DELIVERED" && !old.deliveredDate) data.deliveredDate = toDate(date);
    if (status === "POD RECEIVED") { data.podReceivedDate = toDate(date); if (!old.deliveredDate) data.deliveredDate = toDate(date); }
    const t = await tx.trip.update({ where: { id }, data });
    await audit(tx, ctx, "STATUS", { type: "TRIP", id, code: t.tripNumber }, { status: old.status }, { status });
    return plain(t);
  });
}

export async function cancelTrip(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "trips.cancel");
  if (!reason || reason.trim().length < 3) throw badRequest("A cancel reason is required.");
  return prisma.$transaction(async (tx) => {
    const old = await tx.trip.findUnique({ where: { id } });
    if (!old) throw notFound("Trip not found.");
    if (old.status === "CANCELLED") throw badRequest("Trip is already cancelled.");
    const inv = await activeInvoiceFor(tx, id);
    if (inv) throw badRequest(`Trip is billed in invoice ${inv.invoice.invoiceNumber}. Cancel the invoice first.`);
    const t = await tx.trip.update({ where: { id }, data: { status: "CANCELLED", cancelReason: reason.trim().slice(0, 500) } });
    await syncSettlement(tx, ctx, t);
    await audit(tx, ctx, "CANCEL", { type: "TRIP", id, code: t.tripNumber }, { status: old.status }, { status: "CANCELLED", cancelReason: t.cancelReason });
    return plain(t);
  });
}
