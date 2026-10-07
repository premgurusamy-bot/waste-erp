import "server-only";
import { prisma } from "@/lib/db";
import { num } from "@/lib/utils";
import { partyState } from "./gst";

export async function tradeContext(mode: "sale" | "purchase") {
  const company = await prisma.company.findFirst({ include: { gstSettings: true } });
  const rates = new Map((await prisma.gstRate.findMany()).map((r) => [r.id, num(r.rate)]));
  const items = await prisma.inventoryItem.findMany({ where: { active: true, ...(mode === "sale" ? { isSaleable: true } : {}) }, orderBy: { name: "asc" } });
  const parties =
    mode === "sale"
      ? await prisma.buyer.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } })
      : await prisma.supplier.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } });
  const locations = await prisma.location.findMany({ where: { status: "ACTIVE" }, orderBy: { code: "asc" } });
  const balances = mode === "sale" ? await prisma.inventoryBalance.findMany() : [];
  return {
    companyState: company?.stateCode ?? "33",
    roundOff: company?.gstSettings?.roundOffInvoices ?? true,
    items: items.map((i) => ({ value: i.id, label: i.name, unit: i.unit, gstRate: i.gstRateId ? rates.get(i.gstRateId) ?? 0 : 0, rate: num(i.defaultSaleRate), hsn: i.hsnCode })),
    parties: parties.map((p) => ({ value: p.id, label: p.name, state: partyState(p.gstin, p.stateCode) })),
    locations: locations.map((l) => ({ value: l.id, label: l.name })),
    stock: Object.fromEntries(balances.map((b) => [`${b.itemId}|${b.locationId}`, num(b.quantity)])),
    defaultLocation: locations.find((l) => l.type === "YARD")?.id ?? "",
  };
}
