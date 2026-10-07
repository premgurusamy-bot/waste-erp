import { prisma } from "@/lib/db";
import { formatDate, formatMoney, formatQty } from "@/lib/utils";

export type SearchHit = { type: string; title: string; subtitle: string; href: string };

/** Global search across the main entities the user can see. */
export async function globalSearch(q: string, permissions: string[]): Promise<SearchHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const has = (p: string) => permissions.includes(p);
  const ci = { contains: term, mode: "insensitive" as const };
  const hits: SearchHit[] = [];
  const take = 8;
  const tasks: Promise<void>[] = [];

  if (has("customers.view")) {
    tasks.push(
      prisma.customer.findMany({ where: { OR: [{ name: ci }, { code: ci }, { gstin: ci }, { mobile: ci }] }, take }).then((r) => {
        for (const c of r) hits.push({ type: "Customer", title: `${c.name}`, subtitle: `${c.code} ${c.gstin ?? ""}`, href: `/customers/${c.id}` });
      }),
      prisma.customerSite.findMany({ where: { OR: [{ name: ci }, { code: ci }, { address: ci }] }, include: { customer: true }, take }).then((r) => {
        for (const s of r) hits.push({ type: "Site", title: s.name, subtitle: `${s.code} - ${s.customer.name}`, href: `/sites/${s.id}` });
      }),
    );
  }
  if (has("billing.view")) {
    tasks.push(
      prisma.customerInvoice.findMany({ where: { OR: [{ number: ci }, { customer: { name: ci } }] }, include: { customer: true }, take, orderBy: { date: "desc" } }).then((r) => {
        for (const i of r) hits.push({ type: "Invoice", title: i.number, subtitle: `${i.customer.name} - ${formatDate(i.date)} - ${formatMoney(i.total)}`, href: `/invoices/${i.id}` });
      }),
    );
  }
  if (has("pickups.view")) {
    tasks.push(
      prisma.pickupRequest.findMany({ where: { OR: [{ number: ci }, { customer: { name: ci } }] }, include: { customer: true }, take, orderBy: { requestedDate: "desc" } }).then((r) => {
        for (const p of r) hits.push({ type: "Pickup", title: p.number, subtitle: `${p.customer.name} - ${formatDate(p.requestedDate)} - ${p.status}`, href: `/pickups?q=${encodeURIComponent(p.number)}` });
      }),
    );
  }
  if (has("weighments.view")) {
    tasks.push(
      prisma.weighment.findMany({ where: { OR: [{ number: ci }, { slipNumber: ci }, { vehicle: { number: ci } }] }, include: { vehicle: true, customer: true }, take, orderBy: { gateInAt: "desc" } }).then((r) => {
        for (const w of r) hits.push({ type: "Weighment", title: w.number, subtitle: `${w.vehicle.number} - ${w.customer.name} - Net ${formatQty(w.netWeight, "KG")}`, href: `/weighments/${w.id}` });
      }),
    );
  }
  if (has("vehicles.view")) {
    tasks.push(
      prisma.vehicle.findMany({ where: { OR: [{ number: ci }, { rcNumber: ci }] }, take }).then((r) => {
        for (const v of r) hits.push({ type: "Vehicle", title: v.number, subtitle: `${v.type} - ${v.status}`, href: `/vehicles/${v.id}` });
      }),
    );
  }
  if (has("drivers.view")) {
    tasks.push(
      prisma.driver.findMany({ where: { OR: [{ name: ci }, { code: ci }, { licenceNumber: ci }, { mobile: ci }] }, take }).then((r) => {
        for (const d of r) hits.push({ type: "Driver", title: d.name, subtitle: `${d.code} - ${d.licenceNumber}`, href: `/drivers/${d.id}` });
      }),
    );
  }
  if (has("sales.view")) {
    tasks.push(
      prisma.salesInvoice.findMany({ where: { OR: [{ number: ci }, { buyer: { name: ci } }] }, include: { buyer: true }, take, orderBy: { date: "desc" } }).then((r) => {
        for (const s of r) hits.push({ type: "Sale", title: s.number, subtitle: `${s.buyer.name} - ${formatMoney(s.total)}`, href: `/sales/${s.id}` });
      }),
    );
  }
  if (has("receipts.view")) {
    tasks.push(
      prisma.receipt.findMany({ where: { OR: [{ number: ci }, { reference: ci }, { customer: { name: ci } }, { buyer: { name: ci } }] }, include: { customer: true, buyer: true }, take, orderBy: { date: "desc" } }).then((r) => {
        for (const p of r) hits.push({ type: "Payment", title: p.number, subtitle: `${p.customer?.name ?? p.buyer?.name} - ${formatMoney(p.amount)} - ${formatDate(p.date)}`, href: `/receipts/${p.id}` });
      }),
    );
  }
  if (has("inventory.view")) {
    tasks.push(
      prisma.inventoryItem.findMany({ where: { OR: [{ name: ci }, { code: ci }] }, take }).then((r) => {
        for (const m of r) hits.push({ type: "Material", title: m.name, subtitle: `${m.code} - ${m.itemType}`, href: `/inventory?item=${m.id}` });
      }),
    );
  }
  await Promise.all(tasks);
  return hits;
}
