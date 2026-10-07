import type { Tx } from "@/lib/db";
import { round2 } from "@/lib/utils";

export type TaxSplit = { taxableValue: number; gstRate: number; cgst: number; sgst: number; igst: number; total: number };

/** Split GST into CGST+SGST (intra-state) or IGST (inter-state). */
export function computeTax(taxableValue: number, gstRate: number, interState: boolean, gstEnabled = true): TaxSplit {
  const taxable = round2(taxableValue);
  const rate = gstEnabled ? gstRate : 0;
  if (interState) {
    const igst = round2((taxable * rate) / 100);
    return { taxableValue: taxable, gstRate: rate, cgst: 0, sgst: 0, igst, total: round2(taxable + igst) };
  }
  const half = round2((taxable * rate) / 200);
  return { taxableValue: taxable, gstRate: rate, cgst: half, sgst: half, igst: 0, total: round2(taxable + half * 2) };
}

export function sumTaxes(lines: TaxSplit[]) {
  const subtotal = round2(lines.reduce((s, l) => s + l.taxableValue, 0));
  const cgst = round2(lines.reduce((s, l) => s + l.cgst, 0));
  const sgst = round2(lines.reduce((s, l) => s + l.sgst, 0));
  const igst = round2(lines.reduce((s, l) => s + l.igst, 0));
  return { subtotal, cgst, sgst, igst, gross: round2(subtotal + cgst + sgst + igst) };
}

export function roundOffTotal(gross: number, enabled: boolean) {
  if (!enabled) return { total: round2(gross), roundOff: 0 };
  const total = Math.round(gross);
  return { total, roundOff: round2(total - gross) };
}

/** State code from a GSTIN (first two digits), falling back to the stored state code. */
export function partyState(gstin?: string | null, stateCode?: string | null): string | null {
  if (gstin && /^\d{2}/.test(gstin)) return gstin.slice(0, 2);
  return stateCode || null;
}

export async function getGstContext(tx: Tx) {
  const company = await tx.company.findFirst({ include: { gstSettings: true } });
  const settings = company?.gstSettings;
  const rates = await tx.gstRate.findMany();
  const rateById = new Map(rates.map((r) => [r.id, Number(r.rate)]));
  return {
    companyState: company?.stateCode ?? "33",
    gstEnabled: settings?.gstEnabled ?? true,
    roundOff: settings?.roundOffInvoices ?? true,
    defaultServiceSac: settings?.defaultServiceSac ?? "999432",
    defaultServiceRate: settings?.defaultServiceRateId ? rateById.get(settings.defaultServiceRateId) ?? 0 : 0,
    defaultGoodsRate: settings?.defaultGoodsRateId ? rateById.get(settings.defaultGoodsRateId) ?? 0 : 0,
    rateById,
    isInterState(gstin?: string | null, stateCode?: string | null) {
      const s = partyState(gstin, stateCode);
      return !!s && s !== (company?.stateCode ?? "33");
    },
  };
}
