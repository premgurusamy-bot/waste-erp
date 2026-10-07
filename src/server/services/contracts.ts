import type { BillingMethod, CustomerRate } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { addDays, dateOnly } from "@/lib/utils";
import { contractSchema, rateRevisionSchema, rateSchema } from "@/lib/validation";
import { audit, diff } from "../audit";
import { assertCan, type Ctx } from "../context";
import { AppError } from "../errors";
import { nextNumber } from "../numbering";

export async function createContract(ctx: Ctx, input: unknown) {
  assertCan(ctx, "contracts.manage");
  const i = contractSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: i.customerId } });
    if (!customer) throw new AppError("Customer not found.");
    const number = await nextNumber(tx, "CONTRACT", dateOnly(i.startDate));
    const c = await tx.contract.create({
      data: {
        number,
        customerId: i.customerId,
        title: i.title,
        startDate: dateOnly(i.startDate),
        endDate: i.endDate ? dateOnly(i.endDate) : null,
        paymentTermsDays: i.paymentTermsDays,
        status: i.status,
        remarks: i.remarks ?? null,
        createdById: ctx.userId,
      },
    });
    await audit(tx, ctx, { action: "CREATE", module: "contracts", recordId: c.id, recordLabel: `${c.number} ${customer.name}`, newValues: c });
    return c;
  });
}

export async function updateContract(ctx: Ctx, id: string, input: unknown) {
  assertCan(ctx, "contracts.manage");
  const i = contractSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const before = await tx.contract.findUnique({ where: { id } });
    if (!before) throw new AppError("Contract not found.");
    if (before.customerId !== i.customerId) throw new AppError("The customer of an existing contract cannot be changed.");
    const c = await tx.contract.update({
      where: { id },
      data: {
        title: i.title,
        startDate: dateOnly(i.startDate),
        endDate: i.endDate ? dateOnly(i.endDate) : null,
        paymentTermsDays: i.paymentTermsDays,
        status: i.status,
        remarks: i.remarks ?? null,
      },
    });
    const ch = diff(before, c);
    await audit(tx, ctx, { action: "UPDATE", module: "contracts", recordId: id, recordLabel: c.number, oldValues: ch.before, newValues: ch.after });
    return c;
  });
}

export async function addRate(ctx: Ctx, input: unknown) {
  assertCan(ctx, "contracts.manage");
  const i = rateSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const contract = await tx.contract.findUnique({ where: { id: i.contractId } });
    if (!contract) throw new AppError("Contract not found.");
    const from = dateOnly(i.effectiveFrom);
    if (from < contract.startDate) throw new AppError("Rate cannot start before the contract start date.", { effectiveFrom: "Before contract start" });
    if (i.siteId) {
      const site = await tx.customerSite.findUnique({ where: { id: i.siteId } });
      if (!site || site.customerId !== contract.customerId) throw new AppError("The selected site does not belong to this customer.");
    }
    if (i.taxTreatment === "TAXABLE" && !i.gstRateId) throw new AppError("Select the GST rate for a taxable rate.", { gstRateId: "Required" });
    const clash = await tx.customerRate.findFirst({
      where: {
        contractId: i.contractId,
        siteId: i.siteId ?? null,
        wasteTypeId: i.wasteTypeId ?? null,
        billingMethod: i.billingMethod,
        status: "ACTIVE",
        effectiveTo: null,
      },
    });
    if (clash) throw new AppError("An active rate already exists for this site / waste type / billing method. Use 'Revise rate' to change it.");
    const r = await tx.customerRate.create({
      data: {
        contractId: i.contractId,
        customerId: contract.customerId,
        siteId: i.siteId ?? null,
        wasteTypeId: i.wasteTypeId ?? null,
        billingMethod: i.billingMethod,
        description: i.description ?? null,
        rate: i.rate,
        unit: i.unit,
        taxTreatment: i.taxTreatment,
        gstRateId: i.taxTreatment === "TAXABLE" ? i.gstRateId ?? null : null,
        sacCode: i.sacCode ?? null,
        effectiveFrom: from,
        createdById: ctx.userId,
      },
    });
    await audit(tx, ctx, { action: "CREATE", module: "contracts", recordId: r.id, recordLabel: `Rate on ${contract.number}`, newValues: r });
    return r;
  });
}

/**
 * Revise a rate from a new effective date. The old version is closed (effectiveTo = day before)
 * and marked SUPERSEDED; a new version is created. Already-billed invoices are not affected.
 */
export async function reviseRate(ctx: Ctx, input: unknown) {
  assertCan(ctx, "contracts.manage");
  const i = rateRevisionSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const old = await tx.customerRate.findUnique({ where: { id: i.rateId }, include: { contract: true } });
    if (!old || old.status !== "ACTIVE") throw new AppError("Only an active rate can be revised.");
    const from = dateOnly(i.effectiveFrom);
    if (from <= old.effectiveFrom) throw new AppError("New effective date must be after the current version's start date.", { effectiveFrom: "Too early" });
    await tx.customerRate.update({ where: { id: old.id }, data: { effectiveTo: addDays(from, -1), status: "SUPERSEDED" } });
    const r = await tx.customerRate.create({
      data: {
        contractId: old.contractId,
        customerId: old.customerId,
        siteId: old.siteId,
        wasteTypeId: old.wasteTypeId,
        billingMethod: old.billingMethod,
        description: i.description ?? old.description,
        rate: i.rate,
        unit: old.unit,
        taxTreatment: old.taxTreatment,
        gstRateId: old.taxTreatment === "TAXABLE" ? i.gstRateId ?? old.gstRateId : null,
        sacCode: old.sacCode,
        effectiveFrom: from,
        version: old.version + 1,
        previousRateId: old.id,
        createdById: ctx.userId,
      },
    });
    await audit(tx, ctx, {
      action: "UPDATE",
      module: "contracts",
      recordId: r.id,
      recordLabel: `Rate revision v${r.version} on ${old.contract.number}`,
      oldValues: { rate: old.rate, effectiveFrom: old.effectiveFrom, version: old.version },
      newValues: { rate: r.rate, effectiveFrom: r.effectiveFrom, version: r.version },
    });
    return r;
  });
}

export async function cancelRate(ctx: Ctx, rateId: string, reason: string) {
  assertCan(ctx, "contracts.manage");
  return prisma.$transaction(async (tx) => {
    const r = await tx.customerRate.findUnique({ where: { id: rateId }, include: { _count: { select: { invoiceItems: true } } } });
    if (!r) throw new AppError("Rate not found.");
    if (r._count.invoiceItems > 0) throw new AppError("This rate has been used in invoices. Revise it instead of cancelling.");
    const u = await tx.customerRate.update({ where: { id: rateId }, data: { status: "CANCELLED" } });
    await audit(tx, ctx, { action: "CANCEL", module: "contracts", recordId: rateId, recordLabel: "Customer rate", oldValues: { status: r.status }, newValues: { status: u.status, reason } });
    return u;
  });
}

/**
 * Find the rate that applies to a transaction on a given date.
 * Most specific wins: site+waste type > site > waste type > general.
 */
export async function findApplicableRate(
  tx: Tx,
  q: { customerId: string; siteId?: string | null; wasteTypeId?: string | null; method: BillingMethod; date: Date },
): Promise<CustomerRate | null> {
  const candidates = await tx.customerRate.findMany({
    where: {
      customerId: q.customerId,
      billingMethod: q.method,
      status: { not: "CANCELLED" },
      effectiveFrom: { lte: q.date },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: q.date } }],
      contract: { status: "ACTIVE", startDate: { lte: q.date }, OR: [{ endDate: null }, { endDate: { gte: q.date } }] },
    },
  });
  return pickMostSpecific(candidates, q.siteId ?? null, q.wasteTypeId ?? null);
}

export function pickMostSpecific<T extends { siteId: string | null; wasteTypeId: string | null }>(
  candidates: T[],
  siteId: string | null,
  wasteTypeId: string | null,
): T | null {
  let best: T | null = null;
  let bestScore = -1;
  for (const r of candidates) {
    if (r.siteId && r.siteId !== siteId) continue;
    if (r.wasteTypeId && r.wasteTypeId !== wasteTypeId) continue;
    const score = (r.siteId ? 2 : 0) + (r.wasteTypeId ? 1 : 0);
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}
