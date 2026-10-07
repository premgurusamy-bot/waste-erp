import { ArrowRightLeft } from "lucide-react";
import Link from "next/link";
import { stockMovementAction } from "@/app/actions/stock";
import { FormDialog } from "@/components/forms/confirm-action";
import { EntityForm } from "@/components/forms/entity-form";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { FilterBar, FilterField, FSelect, FText, LinkTabs, PageHeader, Section, StatCard } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { str, type SP } from "@/lib/list-params";
import { addDays, cn, dateOnly, formatDate, formatQty, formatTonnes, num, round3, todayISO } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { itemOptions, locationOptions } from "@/server/options";

export const metadata = { title: "Inventory / Stock" };

const TYPE_TONE = { RAW: "amber", RECOVERED: "green", REJECT: "red", OTHER: "grey" } as const;

export default async function InventoryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("inventory.view");
  const sp = await searchParams;
  const tab = str(sp, "tab") ?? (str(sp, "item") ? "ledger" : "stock");
  const itemId = str(sp, "item");
  const locationId = str(sp, "location");
  const to = str(sp, "to") ?? todayISO();
  const from = str(sp, "from") ?? `${to.slice(0, 7)}-01`;
  const [items, locations, balances, itemOpts, locOpts] = await Promise.all([
    prisma.inventoryItem.findMany({ where: { active: true }, orderBy: [{ itemType: "asc" }, { name: "asc" }] }),
    prisma.location.findMany({ orderBy: { code: "asc" } }),
    prisma.inventoryBalance.findMany(),
    itemOptions(),
    locationOptions(),
  ]);
  const manage = user.permissions.includes("inventory.manage");
  const override = user.permissions.includes("inventory.override");
  const qtyOf = (i: string, l?: string) => round3(balances.filter((b) => b.itemId === i && (!l || b.locationId === l)).reduce((s, b) => s + num(b.quantity), 0));
  const byType = (t: string) => round3(items.filter((i) => i.itemType === t).reduce((s, i) => s + qtyOf(i.id), 0));
  const kinds = [
    { value: "TRANSFER", label: "Transfer between locations" },
    { value: "DISPOSAL", label: "Disposal (rejected waste to landfill)" },
    { value: "ADJUSTMENT", label: "Adjustment (+/−, reason required)" },
    ...(override ? [{ value: "OPENING", label: "Opening stock (admin)" }] : []),
  ];

  return (
    <>
      <PageHeader
        title="Inventory / Stock"
        description="Material-wise and location-wise stock with full movement ledger"
        actions={
          manage && (
            <FormDialog label="Stock Movement" icon={<ArrowRightLeft />} title="Record stock movement" variant="default" size="md" wide>
              <EntityForm
                schemaKey="stockMovement"
                cols={2}
                fields={[
                  { name: "kind", label: "Movement Type", type: "select", options: kinds, required: true },
                  { name: "date", label: "Date", type: "date", required: true },
                  { name: "itemId", label: "Material", type: "select", options: itemOpts, required: true },
                  { name: "quantity", label: "Quantity (KG)", type: "number", required: true, help: "Adjustments: use a negative number to reduce stock" },
                  { name: "locationId", label: "From / At Location", type: "select", options: locOpts, required: true },
                  { name: "toLocationId", label: "To Location (transfers)", type: "select", options: locOpts },
                  ...(override ? [{ name: "allowNegative", label: "Admin override", type: "checkbox" as const, help: "Allow stock to go negative (audited)" }] : []),
                  { name: "remarks", label: "Remarks / Reason", type: "textarea" },
                ]}
                defaultValues={{ kind: "TRANSFER", date: todayISO() }}
                action={stockMovementAction}
                successMessage="Stock movement recorded"
              />
            </FormDialog>
          )
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Unprocessed Waste" value={formatTonnes(byType("RAW"))} tone="amber" />
        <StatCard label="Recovered Material" value={formatTonnes(byType("RECOVERED"))} />
        <StatCard label="Rejected (for disposal)" value={formatTonnes(byType("REJECT"))} tone="red" />
        <StatCard label="Low Stock Items" value={items.filter((i) => i.reorderLevel && qtyOf(i.id) < num(i.reorderLevel)).length} tone="slate" />
      </div>
      <LinkTabs base={`/inventory?from=${from}&to=${to}`} active={tab} tabs={[{ key: "stock", label: "Current Stock" }, { key: "ledger", label: "Stock Ledger" }]} />

      {tab === "stock" && (
        <Card>
          <DataTable
            rows={items}
            rowKey={(r) => r.id}
            columns={[
              { key: "code", header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
              { key: "name", header: "Material", cell: (r) => <Link className="font-medium text-navy-700 hover:underline" href={`/inventory?tab=ledger&item=${r.id}`}>{r.name}</Link> },
              { key: "type", header: "Type", cell: (r) => <Badge tone={TYPE_TONE[r.itemType]}>{r.itemType}</Badge> },
              ...locations.map((l) => ({ key: l.id, header: l.name, align: "right" as const, cell: (r: (typeof items)[number]) => { const q = qtyOf(r.id, l.id); return <span className={cn(q < 0 && "text-red-600", q === 0 && "text-slate-300")}>{formatQty(q)}</span>; } })),
              { key: "total", header: "Total (KG)", align: "right", cell: (r) => { const q = qtyOf(r.id); const low = r.reorderLevel && q < num(r.reorderLevel); return <b className={low ? "text-amber-700" : undefined}>{formatQty(q)}{low ? " ⚠" : ""}</b>; } },
            ]}
          />
        </Card>
      )}

      {tab === "ledger" && <Ledger itemId={itemId} locationId={locationId} from={from} to={to} itemOpts={itemOpts} locOpts={locOpts} />}
    </>
  );
}

async function Ledger({ itemId, locationId, from, to, itemOpts, locOpts }: { itemId?: string; locationId?: string; from: string; to: string; itemOpts: { value: string; label: string }[]; locOpts: { value: string; label: string }[] }) {
  const filter = (
    <FilterBar>
      <input type="hidden" name="tab" value="ledger" />
      <FilterField label="Material" className="min-w-64"><FSelect name="item" defaultValue={itemId} options={itemOpts} placeholder="Select material" /></FilterField>
      <FilterField label="Location"><FSelect name="location" defaultValue={locationId} options={locOpts} placeholder="All locations" /></FilterField>
      <FilterField label="From"><FText type="date" name="from" defaultValue={from} /></FilterField>
      <FilterField label="To"><FText type="date" name="to" defaultValue={to} /></FilterField>
    </FilterBar>
  );
  if (!itemId) return <Card>{filter}<p className="px-5 py-8 text-center text-sm text-slate-500">Select a material to view its stock ledger.</p></Card>;
  const where = { itemId, ...(locationId ? { locationId } : {}) };
  const [opening, txns, item] = await Promise.all([
    prisma.inventoryTransaction.aggregate({ where: { ...where, date: { lt: dateOnly(from) } }, _sum: { quantity: true } }),
    prisma.inventoryTransaction.findMany({ where: { ...where, date: { gte: dateOnly(from), lt: addDays(dateOnly(to), 1) } }, include: { location: true }, orderBy: [{ date: "asc" }, { createdAt: "asc" }], take: 2000 }),
    prisma.inventoryItem.findUnique({ where: { id: itemId } }),
  ]);
  let bal = num(opening._sum.quantity);
  const openBal = bal;
  const rows = txns.map((t) => {
    bal = round3(bal + num(t.quantity));
    return { ...t, balance: bal };
  });
  const inward = round3(txns.filter((t) => num(t.quantity) > 0).reduce((s, t) => s + num(t.quantity), 0));
  const outward = round3(-txns.filter((t) => num(t.quantity) < 0).reduce((s, t) => s + num(t.quantity), 0));
  const link = (t: (typeof rows)[number]) => {
    const map: Record<string, string> = { WEIGHMENT: "/weighments/", PROCESSING: "/processing/", SALES_INVOICE: "/sales/", PURCHASE: "/purchases/" };
    return t.refType && map[t.refType] ? <Link className="text-navy-700 hover:underline" href={`${map[t.refType]}${t.refId}`}>{t.refNumber}</Link> : t.refNumber;
  };
  return (
    <Section title={`Stock Ledger · ${item?.name}`}>
      {filter}
      <div className="grid grid-cols-2 gap-3 border-b border-slate-100 p-4 sm:grid-cols-4">
        <StatCard label="Opening" value={formatQty(openBal, "kg")} tone="slate" />
        <StatCard label="Inward" value={formatQty(inward, "kg")} />
        <StatCard label="Outward" value={formatQty(outward, "kg")} tone="amber" />
        <StatCard label="Closing" value={formatQty(bal, "kg")} tone="navy" />
      </div>
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        dense
        empty="No movements in this period"
        columns={[
          { key: "d", header: "Date", cell: (r) => formatDate(r.date) },
          { key: "t", header: "Type", cell: (r) => <span>{r.txnType.replace("_", " ")}{r.isReversal && <Badge tone="red" className="ml-1">Reversal</Badge>}</span> },
          { key: "ref", header: "Reference", cell: link },
          { key: "loc", header: "Location", cell: (r) => r.location.name },
          { key: "in", header: "In", align: "right", cell: (r) => (num(r.quantity) > 0 ? formatQty(r.quantity) : "") },
          { key: "out", header: "Out", align: "right", cell: (r) => (num(r.quantity) < 0 ? formatQty(-num(r.quantity)) : "") },
          { key: "bal", header: "Balance", align: "right", cell: (r) => <b>{formatQty(r.balance)}</b> },
          { key: "rm", header: "Remarks", cell: (r) => <span className="text-xs text-slate-500">{r.remarks}</span> },
        ]}
      />
    </Section>
  );
}
