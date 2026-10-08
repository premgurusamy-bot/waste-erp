import { z } from "zod";
import { prisma, type Tx } from "../db.js";
import { assertCan, type Ctx } from "../context.js";
import { audit } from "../audit.js";
import { nextCode } from "../sequence.js";
import { badRequest, notFound } from "../lib/errors.js";
import { parse, optStr, money, optId, reqId, isoDate } from "../lib/validate.js";
import { plain, pageParams, toDate } from "../lib/util.js";
import { num, round2 } from "../../shared/calc.js";

const paymentSchema = z.object({
  transporterId: reqId,
  settlementId: optId,
  paymentDate: isoDate,
  amount: money.refine((n) => n > 0, "must be more than zero"),
  mode: z.enum(["CASH", "BANK", "UPI", "CHEQUE", "NEFT", "RTGS"]).default("BANK"),
  reference: optStr(100),
  notes: optStr(500),
});

type SettlementRow = Awaited<ReturnType<typeof loadSettlement>>;
async function loadSettlement(db: Tx | typeof prisma, id: string) {
  return db.transporterSettlement.findUnique({
    where: { id },
    include: { trip: { select: { id: true, tripNumber: true, tripDate: true, transporterHire: true, advance: true, status: true, vehicle: { select: { vehicleNumber: true } } } }, transporter: { select: { id: true, name: true } }, payments: { orderBy: { paymentDate: "asc" } } },
  });
}

export function settlementMoney(s: NonNullable<SettlementRow> | any) {
  const hire = num(s.trip.transporterHire), advance = num(s.trip.advance), deductions = num(s.deductions);
  const paid = round2(s.payments.filter((p: any) => p.status === "ACTIVE").reduce((a: number, p: any) => a + num(p.amount), 0));
  const balance = s.status === "CANCELLED" ? 0 : round2(hire - advance - deductions - paid);
  return { hire, advance, deductions, paid, balance };
}

async function recompute(tx: Tx, id: string) {
  const s = await loadSettlement(tx, id);
  if (!s || s.status === "CANCELLED") return;
  const m = settlementMoney(s);
  const status = m.balance <= 0.005 && m.hire > 0 ? "PAID" : m.paid > 0 ? "PARTIAL" : "PENDING";
  const last = s.payments.filter((p) => p.status === "ACTIVE").at(-1);
  await tx.transporterSettlement.update({ where: { id }, data: { status, settlementDate: status === "PAID" ? last?.paymentDate ?? new Date() : null } });
  if (status === "PAID" && s.trip.status === "BILLED") await tx.trip.update({ where: { id: s.trip.id }, data: { status: "SETTLED" } });
}

export async function listSettlements(ctx: Ctx, q: any) {
  assertCan(ctx, "settlements.view");
  const { skip, take, page, pageSize } = pageParams(q);
  const where: any = {};
  if (q.transporterId) where.transporterId = q.transporterId;
  if (q.status) where.status = { in: String(q.status).split(",") };
  if (q.q) where.OR = [{ code: { contains: q.q, mode: "insensitive" } }, { trip: { tripNumber: { contains: q.q, mode: "insensitive" } } }, { transporter: { name: { contains: q.q, mode: "insensitive" } } }];
  const [rows, total] = await Promise.all([
    prisma.transporterSettlement.findMany({
      where, skip, take, orderBy: { code: "desc" },
      include: { trip: { select: { id: true, tripNumber: true, tripDate: true, transporterHire: true, advance: true, status: true, vehicle: { select: { vehicleNumber: true } } } }, transporter: { select: { id: true, name: true } }, payments: true },
    }),
    prisma.transporterSettlement.count({ where }),
  ]);
  return { rows: rows.map((s) => ({ ...plain(s), payments: undefined, ...settlementMoney(s) })), total, page, pageSize };
}

export async function getSettlement(ctx: Ctx, id: string) {
  assertCan(ctx, "settlements.view");
  const s = await loadSettlement(prisma, id);
  if (!s) throw notFound();
  return { ...plain(s), ...settlementMoney(s) };
}

export async function updateDeductions(ctx: Ctx, id: string, body: any) {
  assertCan(ctx, "settlements.edit");
  const deductions = parse(money, body?.deductions);
  const note = parse(optStr(300), body?.deductionNote) ?? null;
  return prisma.$transaction(async (tx) => {
    const s = await loadSettlement(tx, id);
    if (!s) throw notFound();
    if (s.status === "CANCELLED") throw badRequest("Settlement is cancelled.");
    const m = settlementMoney({ ...s, deductions });
    if (m.balance < -0.005) throw badRequest(`Deductions too large: balance would be ${m.balance}.`);
    await tx.transporterSettlement.update({ where: { id }, data: { deductions, deductionNote: note, remarks: body?.remarks ? String(body.remarks).slice(0, 500) : s.remarks } });
    await audit(tx, ctx, "SETTLEMENT", { type: "SETTLEMENT", id, code: s.code }, { deductions: s.deductions, deductionNote: s.deductionNote }, { deductions, deductionNote: note });
    await recompute(tx, id);
    return getSettlement(ctx, id);
  });
}

export async function listPayments(ctx: Ctx, q: any) {
  assertCan(ctx, "settlements.view");
  const { skip, take, page, pageSize } = pageParams(q);
  const where: any = {};
  if (q.transporterId) where.transporterId = q.transporterId;
  if (q.from || q.to) where.paymentDate = { ...(q.from ? { gte: toDate(q.from) } : {}), ...(q.to ? { lte: toDate(q.to) } : {}) };
  if (q.q) where.OR = [{ code: { contains: q.q, mode: "insensitive" } }, { reference: { contains: q.q, mode: "insensitive" } }, { transporter: { name: { contains: q.q, mode: "insensitive" } } }];
  const [rows, total] = await Promise.all([
    prisma.transporterPayment.findMany({ where, skip, take, orderBy: [{ paymentDate: "desc" }, { code: "desc" }], include: { transporter: { select: { id: true, name: true } }, settlement: { select: { id: true, code: true, trip: { select: { tripNumber: true } } } } } }),
    prisma.transporterPayment.count({ where }),
  ]);
  return { rows: plain(rows), total, page, pageSize };
}

export async function createPayment(ctx: Ctx, body: unknown) {
  assertCan(ctx, "settlements.edit");
  const input = parse(paymentSchema, body);
  return prisma.$transaction(async (tx) => {
    const tr = await tx.transporter.findUnique({ where: { id: input.transporterId } });
    if (!tr) throw badRequest("Transporter not found.");
    if (input.settlementId) {
      const s = await loadSettlement(tx, input.settlementId);
      if (!s || s.transporterId !== input.transporterId) throw badRequest("Settlement does not belong to this transporter.");
      if (s.status === "CANCELLED") throw badRequest("Settlement is cancelled.");
      const m = settlementMoney(s);
      if (input.amount > m.balance + 0.005) throw badRequest(`Payment (${input.amount}) is more than the settlement balance (${m.balance}).`);
    }
    const code = await nextCode(tx, "TPY");
    const p = await tx.transporterPayment.create({ data: { ...input, paymentDate: toDate(input.paymentDate)!, code, createdBy: ctx.user.name } });
    await audit(tx, ctx, "PAYMENT", { type: "TRANSPORTER PAYMENT", id: p.id, code }, null, p);
    if (input.settlementId) await recompute(tx, input.settlementId);
    return plain(p);
  });
}

export async function cancelPayment(ctx: Ctx, id: string) {
  assertCan(ctx, "settlements.edit");
  return prisma.$transaction(async (tx) => {
    const p = await tx.transporterPayment.findUnique({ where: { id } });
    if (!p) throw notFound();
    if (p.status === "CANCELLED") throw badRequest("Already cancelled.");
    const u = await tx.transporterPayment.update({ where: { id }, data: { status: "CANCELLED" } });
    await audit(tx, ctx, "CANCEL", { type: "TRANSPORTER PAYMENT", id, code: p.code }, { status: p.status }, { status: "CANCELLED" });
    if (p.settlementId) await recompute(tx, p.settlementId);
    return plain(u);
  });
}
