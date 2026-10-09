import { z } from "zod";
import { prisma } from "../db.js";
import { assertCan, type Ctx } from "../context.js";
import { audit } from "../audit.js";
import { nextCode } from "../sequence.js";
import { badRequest, notFound } from "../lib/errors.js";
import { parse, optStr, money, optId, isoDate, dates } from "../lib/validate.js";
import { plain, pageParams, toDate } from "../lib/util.js";
import { EXPENSE_CATEGORIES } from "../../shared/calc.js";

export const expenseSchema = z.object({
  expenseDate: isoDate,
  category: z.enum(EXPENSE_CATEGORIES),
  amount: money.refine((n) => n > 0, "must be more than zero"),
  tripId: optId, vehicleId: optId, driverId: optId,
  payee: optStr(150),
  paymentMode: z.enum(["CASH", "BANK", "UPI", "CHEQUE", "CARD", "FUEL CARD", "CREDIT"]).default("CASH"),
  paymentStatus: z.enum(["PAID", "UNPAID"]).default("PAID"),
  reference: optStr(100),
  description: optStr(500),
});

export async function listExpenses(ctx: Ctx, q: any) {
  assertCan(ctx, "expenses.view");
  const { skip, take, page, pageSize } = pageParams(q);
  const where: any = {};
  if (q.category) where.category = q.category;
  if (q.status) where.status = q.status;
  if (q.paymentStatus) where.paymentStatus = q.paymentStatus;
  for (const k of ["tripId", "vehicleId", "driverId"]) if (q[k]) where[k] = q[k];
  if (q.from || q.to) where.expenseDate = { ...(q.from ? { gte: toDate(q.from) } : {}), ...(q.to ? { lte: toDate(q.to) } : {}) };
  const term = String(q.q ?? "").trim();
  if (term) where.OR = [{ code: { contains: term, mode: "insensitive" } }, { payee: { contains: term, mode: "insensitive" } }, { description: { contains: term, mode: "insensitive" } }, { reference: { contains: term, mode: "insensitive" } }];
  const [rows, total, sum] = await Promise.all([
    prisma.expense.findMany({ where, skip, take, orderBy: [{ expenseDate: "desc" }, { code: "desc" }], include: { trip: { select: { id: true, tripNumber: true } }, vehicle: { select: { id: true, vehicleNumber: true } }, driver: { select: { id: true, name: true } } } }),
    prisma.expense.count({ where }),
    prisma.expense.aggregate({ where: { ...where, status: "ACTIVE" }, _sum: { amount: true } }),
  ]);
  return { rows: plain(rows), total, page, pageSize, totalAmount: plain(sum._sum.amount) ?? 0 };
}

export async function getExpense(ctx: Ctx, id: string) {
  assertCan(ctx, "expenses.view");
  const e = await prisma.expense.findUnique({ where: { id }, include: { trip: { select: { id: true, tripNumber: true } }, vehicle: { select: { id: true, vehicleNumber: true } }, driver: { select: { id: true, name: true } } } });
  if (!e) throw notFound();
  const documents = await prisma.document.findMany({ where: { entityType: "EXPENSE", entityId: id } });
  return { ...plain(e), documents: plain(documents) };
}

export async function saveExpense(ctx: Ctx, body: unknown, id?: string) {
  assertCan(ctx, "expenses.edit");
  const data = dates(parse(expenseSchema, body), ["expenseDate"]);
  return prisma.$transaction(async (tx) => {
    if (data.tripId) {
      const t = await tx.trip.findUnique({ where: { id: data.tripId } });
      if (!t) throw badRequest("Trip not found.");
      if (!data.vehicleId && t.vehicleId) data.vehicleId = t.vehicleId;
      if (!data.driverId && t.driverId) data.driverId = t.driverId;
    }
    if (id) {
      const old = await tx.expense.findUnique({ where: { id } });
      if (!old) throw notFound();
      if (old.status === "CANCELLED") throw badRequest("A cancelled expense cannot be edited.");
      const e = await tx.expense.update({ where: { id }, data });
      await audit(tx, ctx, "EDIT", { type: "EXPENSE", id, code: e.code }, old, e);
      return plain(e);
    }
    const code = await nextCode(tx, "EXP");
    const e = await tx.expense.create({ data: { ...data, code, createdBy: ctx.user.name } });
    await audit(tx, ctx, "CREATE", { type: "EXPENSE", id: e.id, code }, null, e);
    return plain(e);
  });
}

export async function cancelExpense(ctx: Ctx, id: string) {
  assertCan(ctx, "expenses.edit");
  return prisma.$transaction(async (tx) => {
    const old = await tx.expense.findUnique({ where: { id } });
    if (!old) throw notFound();
    if (old.status === "CANCELLED") throw badRequest("Already cancelled.");
    const e = await tx.expense.update({ where: { id }, data: { status: "CANCELLED" } });
    await audit(tx, ctx, "CANCEL", { type: "EXPENSE", id, code: e.code }, { status: old.status }, { status: "CANCELLED" });
    return plain(e);
  });
}

export async function markExpensePaid(ctx: Ctx, id: string) {
  assertCan(ctx, "expenses.edit");
  return prisma.$transaction(async (tx) => {
    const old = await tx.expense.findUnique({ where: { id } });
    if (!old || old.status === "CANCELLED") throw notFound();
    const e = await tx.expense.update({ where: { id }, data: { paymentStatus: "PAID" } });
    await audit(tx, ctx, "PAYMENT", { type: "EXPENSE", id, code: e.code }, { paymentStatus: old.paymentStatus }, { paymentStatus: "PAID" });
    return plain(e);
  });
}
