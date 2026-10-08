/**
 * Customers, transporters, vehicles, drivers, loading / delivery points and freight rates.
 * Records are never hard-deleted (they can be set INACTIVE), so history and backups stay consistent.
 */
import { z } from "zod";
import { prisma } from "../db.js";
import { assertCan, type Ctx } from "../context.js";
import { audit } from "../audit.js";
import { nextCode } from "../sequence.js";
import { notFound, conflict } from "../lib/errors.js";
import { parse, optStr, reqStr, money, signedMoney, optNum, optDate, optId, gstin, pan, mobile, email, dates } from "../lib/validate.js";
import { plain, pageParams } from "../lib/util.js";

const status = z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE");

export const MASTER_DEFS = {
  customers: {
    model: "customer", prefix: "CUS", label: "Customer", search: ["name", "company", "mobile", "gstin", "code", "city"], order: { name: "asc" },
    schema: z.object({
      name: reqStr(150), company: optStr(150), gstin, pan, contactPerson: optStr(100), mobile, email, address: optStr(500), city: optStr(80), state: optStr(80),
      paymentTerms: optStr(200), creditDays: z.preprocess((v) => (v === "" || v == null ? 30 : Number(v)), z.number().int().min(0).max(365)), openingBalance: signedMoney, status, notes: optStr(1000),
    }),
    dateKeys: [] as string[],
  },
  transporters: {
    model: "transporter", prefix: "TRN", label: "Transporter", search: ["name", "mobile", "gstin", "code", "contactPerson"], order: { name: "asc" },
    schema: z.object({
      name: reqStr(150), contactPerson: optStr(100), mobile, gstin, pan, address: optStr(500), city: optStr(80), bankName: optStr(100), bankAccount: optStr(40),
      bankIfsc: optStr(20), bankBranch: optStr(100), upiId: optStr(100), paymentTerms: optStr(200), openingBalance: signedMoney, status, notes: optStr(1000),
    }),
    dateKeys: [] as string[],
  },
  vehicles: {
    model: "vehicle", prefix: "VEH", label: "Vehicle", search: ["vehicleNumber", "ownerName", "code", "vehicleType"], order: { vehicleNumber: "asc" },
    schema: z.object({
      vehicleNumber: z.preprocess((v) => String(v ?? "").toUpperCase().replace(/[\s-]/g, ""), z.string().min(4, "is required").max(15)),
      vehicleType: optStr(60), capacityTons: optNum, ownerName: optStr(120), ownership: z.enum(["OWN", "MARKET", "ATTACHED"]).default("MARKET"), transporterId: optId,
      rcExpiry: optDate, insuranceExpiry: optDate, fcExpiry: optDate, permitExpiry: optDate, pollutionExpiry: optDate, roadTaxExpiry: optDate, status, notes: optStr(1000),
    }),
    dateKeys: ["rcExpiry", "insuranceExpiry", "fcExpiry", "permitExpiry", "pollutionExpiry", "roadTaxExpiry"],
  },
  drivers: {
    model: "driver", prefix: "DRV", label: "Driver", search: ["name", "mobile", "licenseNumber", "code"], order: { name: "asc" },
    schema: z.object({
      name: reqStr(120), mobile, licenseNumber: optStr(40), licenseExpiry: optDate, address: optStr(500), rate: money,
      rateType: z.enum(["PER_TRIP", "PER_DAY", "PER_MONTH"]).default("PER_TRIP"), transporterId: optId, status, notes: optStr(1000),
    }),
    dateKeys: ["licenseExpiry"],
  },
  loadingPoints: {
    model: "loadingPoint", prefix: "LP", label: "Loading point", search: ["name", "city", "code"], order: { name: "asc" },
    schema: z.object({ name: reqStr(150), address: optStr(500), city: optStr(80), state: optStr(80), pincode: optStr(10), contactPerson: optStr(100), mobile, status }),
    dateKeys: [] as string[],
  },
  deliveryPoints: {
    model: "deliveryPoint", prefix: "DP", label: "Delivery point", search: ["name", "city", "code"], order: { name: "asc" },
    schema: z.object({ name: reqStr(150), address: optStr(500), city: optStr(80), state: optStr(80), pincode: optStr(10), contactPerson: optStr(100), mobile, status }),
    dateKeys: [] as string[],
  },
  freightRates: {
    model: "freightRate", prefix: "FRT", label: "Freight rate", search: ["code", "vehicleType"], order: { code: "asc" },
    schema: z.object({
      customerId: optId, loadingPointId: optId, deliveryPointId: optId, vehicleType: optStr(60), rateType: z.enum(["PER_TRIP", "PER_TON", "PER_KM"]).default("PER_TRIP"),
      customerRate: money, transporterRate: money, effectiveFrom: optDate, effectiveTo: optDate, status, notes: optStr(1000),
    }),
    dateKeys: ["effectiveFrom", "effectiveTo"],
  },
} as const;

export type MasterKind = keyof typeof MASTER_DEFS;
export const isMasterKind = (k: string): k is MasterKind => k in MASTER_DEFS;

const include: Partial<Record<MasterKind, any>> = {
  vehicles: { transporter: { select: { id: true, name: true } } },
  drivers: { transporter: { select: { id: true, name: true } } },
  freightRates: { customer: { select: { id: true, name: true } }, loadingPoint: { select: { id: true, name: true } }, deliveryPoint: { select: { id: true, name: true } } },
};

export async function listMasters(ctx: Ctx, kind: MasterKind, q: any) {
  assertCan(ctx, "masters.view");
  const def = MASTER_DEFS[kind];
  const { skip, take, page, pageSize } = pageParams(q);
  const where: any = {};
  const term = String(q.q ?? "").trim();
  if (term) where.OR = def.search.map((f) => ({ [f]: { contains: term, mode: "insensitive" } }));
  if (q.status) where.status = q.status;
  const d = (prisma as any)[def.model];
  const [rows, total] = await Promise.all([d.findMany({ where, skip, take, orderBy: def.order, include: include[kind] }), d.count({ where })]);
  return { rows: plain(rows), total, page, pageSize };
}

/** Small id/label list for drop-downs (active records only, plus the currently selected one). */
export async function options(ctx: Ctx, kind: MasterKind, term = "") {
  assertCan(ctx, "masters.view");
  const def = MASTER_DEFS[kind];
  const labelField = kind === "vehicles" ? "vehicleNumber" : kind === "freightRates" ? "code" : "name";
  const where: any = { status: "ACTIVE" };
  if (term) where.OR = def.search.map((f) => ({ [f]: { contains: term, mode: "insensitive" } }));
  const rows = await (prisma as any)[def.model].findMany({ where, take: 500, orderBy: def.order });
  return rows.map((r: any) => ({ id: r.id, label: r[labelField], code: r.code, extra: plain(r) }));
}

export async function getMaster(ctx: Ctx, kind: MasterKind, id: string) {
  assertCan(ctx, "masters.view");
  const def = MASTER_DEFS[kind];
  const row = await (prisma as any)[def.model].findUnique({ where: { id }, include: include[kind] });
  if (!row) throw notFound();
  return plain(row);
}

export async function saveMaster(ctx: Ctx, kind: MasterKind, body: unknown, id?: string) {
  assertCan(ctx, "masters.edit");
  const def = MASTER_DEFS[kind];
  const data = dates(parse(def.schema, body) as any, def.dateKeys);
  return prisma.$transaction(async (tx) => {
    const d = (tx as any)[def.model];
    if (kind === "vehicles") {
      const dup = await tx.vehicle.findFirst({ where: { vehicleNumber: data.vehicleNumber, ...(id ? { NOT: { id } } : {}) } });
      if (dup) throw conflict(`Vehicle ${data.vehicleNumber} already exists (${dup.code}).`);
    }
    if (id) {
      const old = await d.findUnique({ where: { id } });
      if (!old) throw notFound();
      const row = await d.update({ where: { id }, data });
      await audit(tx, ctx, "EDIT", { type: def.label.toUpperCase(), id, code: row.code }, old, row);
      return plain(row);
    }
    const code = await nextCode(tx, def.prefix);
    const row = await d.create({ data: { ...data, code } });
    await audit(tx, ctx, "CREATE", { type: def.label.toUpperCase(), id: row.id, code }, null, row);
    return plain(row);
  });
}

/** Find the freight rate card that applies to a trip (most specific match wins). */
export async function findRate(ctx: Ctx, q: { customerId?: string; loadingPointId?: string; deliveryPointId?: string; vehicleType?: string; date?: string }) {
  assertCan(ctx, "masters.view");
  const date = q.date ? new Date(`${q.date}T00:00:00Z`) : new Date();
  const rates = await prisma.freightRate.findMany({
    where: {
      status: "ACTIVE",
      AND: [
        q.customerId ? { OR: [{ customerId: q.customerId }, { customerId: null }] } : { customerId: null },
        q.loadingPointId ? { OR: [{ loadingPointId: q.loadingPointId }, { loadingPointId: null }] } : { loadingPointId: null },
        q.deliveryPointId ? { OR: [{ deliveryPointId: q.deliveryPointId }, { deliveryPointId: null }] } : { deliveryPointId: null },
        { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: date } }] },
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] },
      ],
    },
  });
  const score = (r: any) => (r.customerId ? 4 : 0) + (r.loadingPointId ? 2 : 0) + (r.deliveryPointId ? 2 : 0) + (r.vehicleType && r.vehicleType === q.vehicleType ? 1 : 0);
  const candidates = rates.filter((r) => !r.vehicleType || r.vehicleType === q.vehicleType).sort((a, b) => score(b) - score(a));
  return candidates[0] ? plain(candidates[0]) : null;
}
