import type { BillingMethod, RateUnit } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { addDays, dateOnly, formatDate, localDayRange, num, round2, round3, todayISO, toISODate } from "@/lib/utils";
import { customerInvoiceSchema } from "@/lib/validation";
import { ACC, postJournal, reverseJournal } from "../accounting";
import { audit } from "../audit";
import { assertCan, type Ctx } from "../context";
import { AppError } from "../errors";
import { computeTax, getGstContext, roundOffTotal, sumTaxes } from "../gst";
import { nextNumber } from "../numbering";
import { pickMostSpecific } from "./contracts";

export type BillingLine = {
  key: string;
  rateId: string | null;
  billingMethod: BillingMethod | null;
  description: string;
  siteId: string | null;
  wasteTypeId: string | null;
  quantity: number;
  unit: string;
  rate: number;
  gstRate: number;
  sacCode: string | null;
  weighmentIds: string[];
  collectionIds: string[];
};

export type BillingPreview = {
  lines: BillingLine[];
  warnings: string[];
};

/** Billing amount for one line: Quantity x Rate (trips x rate, months x amount, weight x rate). */
export function lineAmount(quantity: number, rate: number) {
  return round2(quantity * rate);
}

/** Convert a weight in KG to the unit a rate is quoted in. */
export function convertWeight(kg: number, unit: RateUnit) {
  return unit === "TONNE" ? round3(kg / 1000) : round3(kg);
}

function monthsCovered(from: Date, to: Date): number {
  if (to < from) return 0;
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth()) + 1;
}

/**
 * Work out what should be billed to a customer for a period, using the contract rate
 * that was effective on each transaction's date. Nothing is written.
 */
export async function previewBilling(
  tx: Tx,
  q: { customerId: string; siteId?: string | null; periodFrom: string; periodTo: string },
): Promise<BillingPreview> {
  const gst = await getGstContext(tx);
  const range = localDayRange(q.periodFrom, q.periodTo);
  const pFrom = dateOnly(q.periodFrom);
  const pTo = dateOnly(q.periodTo);
  const rates = await tx.customerRate.findMany({
    where: { customerId: q.customerId, status: { not: "CANCELLED" }, contract: { status: { in: ["ACTIVE", "EXPIRED"] } } },
    include: { contract: true, wasteType: true, site: true },
  });
  const rateFor = (method: BillingMethod, siteId: string | null, wasteTypeId: string | null, day: Date) =>
    pickMostSpecific(
      rates.filter(
        (r) =>
          r.billingMethod === method &&
          r.effectiveFrom <= day &&
          (!r.effectiveTo || r.effectiveTo >= day) &&
          r.contract.startDate <= day &&
          (!r.contract.endDate || r.contract.endDate >= day),
      ),
      siteId,
      wasteTypeId,
    );
  const gstOf = (r: (typeof rates)[number]) => (r.taxTreatment === "EXEMPT" ? 0 : r.gstRateId ? gst.rateById.get(r.gstRateId) ?? 0 : gst.defaultServiceRate);

  const lines = new Map<string, BillingLine & { kg: number }>();
  const warnings: string[] = [];
  const siteFilter = q.siteId ? { siteId: q.siteId } : {};

  // 1) Weight based: completed, unbilled weighments in the period
  const weighments = await tx.weighment.findMany({
    where: { customerId: q.customerId, status: "COMPLETED", customerInvoiceItemId: null, gateInAt: range, ...siteFilter },
    include: { wasteType: true, site: true },
    orderBy: { gateInAt: "asc" },
  });
  for (const w of weighments) {
    const day = dateOnly(todayISO(w.gateInAt));
    const r = rateFor("WEIGHT", w.siteId, w.wasteTypeId, day);
    if (!r) {
      const tripRate = rateFor("TRIP", w.siteId, w.wasteTypeId, day);
      const monthly = rateFor("MONTHLY", w.siteId, w.wasteTypeId, day);
      if (!tripRate && !monthly) warnings.push(`Weighment ${w.number} (${formatDate(day)}) has no applicable weight-based rate and was not billed.`);
      continue;
    }
    const key = `W:${r.id}`;
    const line =
      lines.get(key) ??
      ({
        key,
        rateId: r.id,
        billingMethod: "WEIGHT",
        description: "",
        siteId: r.siteId ?? w.siteId,
        wasteTypeId: r.wasteTypeId ?? w.wasteTypeId,
        quantity: 0,
        kg: 0,
        unit: r.unit,
        rate: num(r.rate),
        gstRate: gstOf(r),
        sacCode: r.sacCode ?? gst.defaultServiceSac,
        weighmentIds: [],
        collectionIds: [],
      } as BillingLine & { kg: number });
    line.kg = round3(line.kg + num(w.netWeight));
    line.quantity = convertWeight(line.kg, r.unit);
    line.weighmentIds.push(w.id);
    line.description = `${r.description || `${w.wasteType.name} collection & disposal`} - weight based (${line.weighmentIds.length} weighment${line.weighmentIds.length > 1 ? "s" : ""})${w.site ? ` - ${w.site.name}` : ""}`;
    lines.set(key, line);
  }

  // 2) Trip based: completed/partial, unbilled collection trips in the period
  const collections = await tx.collectionEntry.findMany({
    where: {
      customerId: q.customerId,
      status: { in: ["COMPLETED", "PARTIAL"] },
      customerInvoiceItemId: null,
      collectionDate: range,
      ...siteFilter,
    },
    include: { wasteType: true, site: true },
    orderBy: { collectionDate: "asc" },
  });
  for (const c of collections) {
    const day = dateOnly(todayISO(c.collectionDate));
    const r = rateFor("TRIP", c.siteId, c.wasteTypeId, day);
    if (!r) continue; // weight-based or monthly customers are not billed per trip
    const key = `T:${r.id}`;
    const line =
      lines.get(key) ??
      ({
        key,
        rateId: r.id,
        billingMethod: "TRIP",
        description: "",
        siteId: r.siteId ?? c.siteId,
        wasteTypeId: r.wasteTypeId ?? c.wasteTypeId,
        quantity: 0,
        kg: 0,
        unit: "TRIP",
        rate: num(r.rate),
        gstRate: gstOf(r),
        sacCode: r.sacCode ?? gst.defaultServiceSac,
        weighmentIds: [],
        collectionIds: [],
      } as BillingLine & { kg: number });
    line.quantity += 1;
    line.collectionIds.push(c.id);
    line.description = `${r.description || `${c.wasteType.name} collection`} - trip based (${line.quantity} trip${line.quantity > 1 ? "s" : ""}) - ${c.site.name}`;
    lines.set(key, line);
  }

  // 3) Monthly fixed contract amounts
  for (const r of rates.filter((x) => x.billingMethod === "MONTHLY")) {
    if (q.siteId && r.siteId && r.siteId !== q.siteId) continue;
    const from = new Date(Math.max(pFrom.getTime(), r.effectiveFrom.getTime(), r.contract.startDate.getTime()));
    const toCandidates = [pTo.getTime(), r.effectiveTo?.getTime(), r.contract.endDate?.getTime()].filter((x): x is number => !!x);
    const to = new Date(Math.min(...toCandidates));
    const months = monthsCovered(from, to);
    if (months <= 0) continue;
    const already = await tx.customerInvoiceItem.findFirst({
      where: {
        rateId: r.id,
        invoice: { status: "POSTED", periodFrom: { lte: to }, periodTo: { gte: from } },
      },
      include: { invoice: true },
    });
    if (already) {
      warnings.push(`Monthly charge "${r.description ?? "contract"}" for this period is already billed on ${already.invoice.number}.`);
      continue;
    }
    lines.set(`M:${r.id}`, {
      key: `M:${r.id}`,
      rateId: r.id,
      billingMethod: "MONTHLY",
      description: `${r.description || "Monthly waste management contract"} (${formatDate(from)} to ${formatDate(to)})${r.site ? ` - ${r.site.name}` : ""}`,
      siteId: r.siteId,
      wasteTypeId: r.wasteTypeId,
      quantity: months,
      kg: 0,
      unit: "MONTH",
      rate: num(r.rate),
      gstRate: gstOf(r),
      sacCode: r.sacCode ?? gst.defaultServiceSac,
      weighmentIds: [],
      collectionIds: [],
    });
  }

  return { lines: [...lines.values()].map(({ kg: _kg, ...l }) => l), warnings };
}

export async function getBillingPreview(ctx: Ctx, q: { customerId: string; siteId?: string | null; periodFrom: string; periodTo: string }) {
  assertCan(ctx, "billing.view");
  return previewBilling(prisma, q);
}

export async function createCustomerInvoice(ctx: Ctx, input: unknown) {
  assertCan(ctx, "billing.manage");
  const i = customerInvoiceSchema.parse(input);
  return prisma.$transaction(
    async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: i.customerId } });
      if (!customer) throw new AppError("Customer not found.");
      const gst = await getGstContext(tx);
      const preview = i.includeAuto ? await previewBilling(tx, i) : { lines: [], warnings: [] };
      const manual: BillingLine[] = i.manualLines.map((m, idx) => ({
        key: `X:${idx}`,
        rateId: null,
        billingMethod: null,
        description: m.description,
        siteId: i.siteId ?? null,
        wasteTypeId: null,
        quantity: m.quantity,
        unit: m.unit,
        rate: m.rate,
        gstRate: m.gstRate ?? gst.defaultServiceRate,
        sacCode: m.sacCode ?? gst.defaultServiceSac,
        weighmentIds: [],
        collectionIds: [],
      }));
      const all = [...preview.lines, ...manual].filter((l) => l.quantity > 0);
      if (all.length === 0) throw new AppError("There is nothing to bill for this customer and period.");

      const interState = gst.isInterState(customer.gstin, customer.stateCode);
      const taxed = all.map((l) => ({ line: l, tax: computeTax(lineAmount(l.quantity, l.rate), l.gstRate, interState, gst.gstEnabled) }));
      const totals = sumTaxes(taxed.map((t) => t.tax));
      const { total, roundOff } = roundOffTotal(totals.gross, gst.roundOff);

      const contract = await tx.contract.findFirst({
        where: { customerId: customer.id, status: "ACTIVE" },
        orderBy: { startDate: "desc" },
      });
      const terms = contract?.paymentTermsDays ?? customer.creditDays;
      const date = dateOnly(i.date);
      const number = await nextNumber(tx, "CUSTOMER_INVOICE", date);
      const inv = await tx.customerInvoice.create({
        data: {
          number,
          date,
          customerId: customer.id,
          siteId: i.siteId ?? null,
          contractId: contract?.id ?? null,
          periodFrom: dateOnly(i.periodFrom),
          periodTo: dateOnly(i.periodTo),
          isInterState: interState,
          placeOfSupply: customer.stateCode ?? gst.companyState,
          subtotal: totals.subtotal,
          cgst: totals.cgst,
          sgst: totals.sgst,
          igst: totals.igst,
          roundOff,
          total,
          paymentTermsDays: terms,
          dueDate: addDays(date, terms),
          notes: i.notes ?? null,
          createdById: ctx.userId,
        },
      });
      for (const { line, tax } of taxed) {
        const item = await tx.customerInvoiceItem.create({
          data: {
            invoiceId: inv.id,
            rateId: line.rateId,
            billingMethod: line.billingMethod,
            wasteTypeId: line.wasteTypeId,
            siteId: line.siteId,
            description: line.description,
            sacCode: line.sacCode,
            quantity: line.quantity,
            unit: line.unit,
            rate: line.rate,
            taxableValue: tax.taxableValue,
            gstRate: tax.gstRate,
            cgst: tax.cgst,
            sgst: tax.sgst,
            igst: tax.igst,
            total: tax.total,
          },
        });
        // Link source transactions; the null check prevents double billing under concurrency.
        if (line.weighmentIds.length) {
          const r = await tx.weighment.updateMany({
            where: { id: { in: line.weighmentIds }, customerInvoiceItemId: null },
            data: { customerInvoiceItemId: item.id },
          });
          if (r.count !== line.weighmentIds.length) throw new AppError("Some weighments were billed by another user. Refresh and try again.");
        }
        if (line.collectionIds.length) {
          const r = await tx.collectionEntry.updateMany({
            where: { id: { in: line.collectionIds }, customerInvoiceItemId: null },
            data: { customerInvoiceItemId: item.id },
          });
          if (r.count !== line.collectionIds.length) throw new AppError("Some collections were billed by another user. Refresh and try again.");
        }
      }
      await postJournal(tx, ctx, {
        date,
        narration: `Customer invoice ${number} - ${customer.name}`,
        sourceType: "CUSTOMER_INVOICE",
        sourceId: inv.id,
        sourceNumber: number,
        lines: [
          { accountCode: ACC.AR_CUSTOMERS, debit: total, partyType: "CUSTOMER", partyId: customer.id },
          { accountCode: ACC.SERVICE_INCOME, credit: totals.subtotal },
          { accountCode: ACC.GST_OUT_CGST, credit: totals.cgst },
          { accountCode: ACC.GST_OUT_SGST, credit: totals.sgst },
          { accountCode: ACC.GST_OUT_IGST, credit: totals.igst },
          { accountCode: ACC.ROUND_OFF, credit: roundOff },
        ],
      });
      await audit(tx, ctx, {
        action: "CREATE",
        module: "billing",
        recordId: inv.id,
        recordLabel: `${number} ${customer.name}`,
        newValues: { number, total, subtotal: totals.subtotal, lines: taxed.length, period: `${i.periodFrom} to ${i.periodTo}` },
      });
      return inv;
    },
    { timeout: 30_000 },
  );
}

export async function cancelCustomerInvoice(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "billing.manage");
  if (!reason || reason.trim().length < 3) throw new AppError("Enter a cancellation reason.");
  return prisma.$transaction(async (tx) => {
    const inv = await tx.customerInvoice.findUnique({ where: { id }, include: { items: true } });
    if (!inv || inv.status === "CANCELLED") throw new AppError("Invoice not found or already cancelled.");
    if (num(inv.amountReceived) > 0) throw new AppError("Payments are allocated to this invoice. Cancel those receipts first.");
    const itemIds = inv.items.map((x) => x.id);
    await tx.weighment.updateMany({ where: { customerInvoiceItemId: { in: itemIds } }, data: { customerInvoiceItemId: null } });
    await tx.collectionEntry.updateMany({ where: { customerInvoiceItemId: { in: itemIds } }, data: { customerInvoiceItemId: null } });
    await reverseJournal(tx, ctx, "CUSTOMER_INVOICE", inv.id, dateOnly(todayISO()), reason);
    const u = await tx.customerInvoice.update({ where: { id }, data: { status: "CANCELLED", cancelReason: reason } });
    await audit(tx, ctx, { action: "CANCEL", module: "billing", recordId: id, recordLabel: inv.number, oldValues: { status: inv.status, total: inv.total }, newValues: { status: "CANCELLED", reason } });
    return u;
  });
}

export function invoicePeriodDefaults(today = todayISO()) {
  const d = dateOnly(today);
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
  return { periodFrom: toISODate(first), periodTo: toISODate(last) };
}
