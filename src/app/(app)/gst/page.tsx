import { FileDown, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { saveEntityAction } from "@/app/actions/masters";
import { gstSettingsAction } from "@/app/actions/settings";
import { FormDialog } from "@/components/forms/confirm-action";
import { EntityForm } from "@/components/forms/entity-form";
import { ActiveToggle } from "@/components/shared/active-toggle";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { FilterBar, FilterField, FText, LinkTabs, PageHeader, StatCard } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { gstRateFields, toFormValues } from "@/lib/fields";
import { str, type SP } from "@/lib/list-params";
import { dateOnly, formatDate, formatMoney, num, round2, todayISO } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { gstSummary } from "@/server/reports";
import { gstRateOptions } from "@/server/options";

export const metadata = { title: "GST" };

export default async function GstPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("gst.view");
  const sp = await searchParams;
  const tab = str(sp, "tab") ?? "summary";
  const to = str(sp, "to") ?? todayISO();
  const from = str(sp, "from") ?? `${to.slice(0, 7)}-01`;
  const manage = user.permissions.includes("gst.manage");
  const base = `/gst?from=${from}&to=${to}`;
  const filter = (
    <FilterBar>
      <input type="hidden" name="tab" value={tab} />
      <FilterField label="From"><FText type="date" name="from" defaultValue={from} /></FilterField>
      <FilterField label="To"><FText type="date" name="to" defaultValue={to} /></FilterField>
      <a href={`/api/reports/gst/export?format=xlsx&from=${from}&to=${to}`} className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm hover:bg-slate-50"><FileDown className="size-4" /> Excel</a>
    </FilterBar>
  );
  return (
    <>
      <PageHeader title="GST" description="Output tax on sales, input tax on purchases and expenses, configurable rates" />
      <LinkTabs base={base} active={tab} tabs={[
        { key: "summary", label: "Tax Summary" },
        { key: "sales", label: "Output Register (Sales)" },
        { key: "purchases", label: "Input Register (Purchases)" },
        { key: "rates", label: "GST Rates" },
        { key: "settings", label: "GST Settings" },
      ]} />
      {tab === "summary" && <Summary from={from} to={to} filter={filter} />}
      {tab === "sales" && <SalesRegister from={from} to={to} filter={filter} />}
      {tab === "purchases" && <PurchaseRegister from={from} to={to} filter={filter} />}
      {tab === "rates" && <Rates manage={manage} />}
      {tab === "settings" && <Settings manage={manage} />}
    </>
  );
}

async function Summary({ from, to, filter }: { from: string; to: string; filter: React.ReactNode }) {
  const rows = await gstSummary({ from, to });
  const out = rows.filter((r) => r.type === "Output");
  const inp = rows.filter((r) => r.type === "Input");
  const s = (list: typeof rows, k: string) => round2(list.reduce((a, r) => a + (r[k] as number), 0));
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Taxable Sales" value={formatMoney(s(out, "taxable"))} tone="navy" />
        <StatCard label="Output GST" value={formatMoney(s(out, "tax"))} sub={`CGST ${formatMoney(s(out, "cgst"))} · SGST ${formatMoney(s(out, "sgst"))} · IGST ${formatMoney(s(out, "igst"))}`} />
        <StatCard label="Input GST (ITC)" value={formatMoney(s(inp, "tax"))} tone="slate" />
        <StatCard label="Net GST Payable" value={formatMoney(s(out, "tax") - s(inp, "tax"))} tone="amber" sub="Output − input (before adjustments)" />
      </div>
      <Card>
        {filter}
        <DataTable
          rows={rows}
          rowKey={(r) => `${r.type}${r.source}${r.rate}`}
          empty="No taxable transactions in this period"
          columns={[
            { key: "t", header: "Type", cell: (r) => <Badge tone={r.type === "Output" ? "blue" : "green"}>{r.type}</Badge> },
            { key: "s", header: "Source", cell: (r) => r.source },
            { key: "r", header: "Rate", align: "right", cell: (r) => `${r.rate}%` },
            { key: "tx", header: "Taxable", align: "right", cell: (r) => formatMoney(r.taxable) },
            { key: "c", header: "CGST", align: "right", cell: (r) => formatMoney(r.cgst) },
            { key: "sg", header: "SGST", align: "right", cell: (r) => formatMoney(r.sgst) },
            { key: "i", header: "IGST", align: "right", cell: (r) => formatMoney(r.igst) },
            { key: "tot", header: "Total Tax", align: "right", cell: (r) => <b>{formatMoney(r.tax)}</b> },
          ]}
        />
      </Card>
    </>
  );
}

async function SalesRegister({ from, to, filter }: { from: string; to: string; filter: React.ReactNode }) {
  const range = { gte: dateOnly(from), lte: dateOnly(to) };
  const [inv, sales] = await Promise.all([
    prisma.customerInvoice.findMany({ where: { status: "POSTED", date: range }, include: { customer: true }, orderBy: { date: "asc" } }),
    prisma.salesInvoice.findMany({ where: { status: "POSTED", date: range }, include: { buyer: true }, orderBy: { date: "asc" } }),
  ]);
  const rows = [
    ...inv.map((i) => ({ id: i.id, href: `/invoices/${i.id}`, kind: "Customer invoice", number: i.number, date: i.date, party: i.customer.name, gstin: i.customer.gstin, pos: i.placeOfSupply, taxable: i.subtotal, cgst: i.cgst, sgst: i.sgst, igst: i.igst, total: i.total })),
    ...sales.map((i) => ({ id: i.id, href: `/sales/${i.id}`, kind: "Recyclable sale", number: i.number, date: i.date, party: i.buyer.name, gstin: i.buyer.gstin, pos: i.placeOfSupply, taxable: i.subtotal, cgst: i.cgst, sgst: i.sgst, igst: i.igst, total: i.total })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());
  return <Register rows={rows} filter={filter} />;
}

async function PurchaseRegister({ from, to, filter }: { from: string; to: string; filter: React.ReactNode }) {
  const range = { gte: dateOnly(from), lte: dateOnly(to) };
  const [pur, exp] = await Promise.all([
    prisma.purchase.findMany({ where: { status: "POSTED", date: range }, include: { supplier: true }, orderBy: { date: "asc" } }),
    prisma.expense.findMany({ where: { status: "POSTED", date: range, gstRate: { gt: 0 } }, include: { supplier: true, category: true }, orderBy: { date: "asc" } }),
  ]);
  const rows = [
    ...pur.map((i) => ({ id: i.id, href: `/purchases/${i.id}`, kind: "Purchase", number: `${i.number}${i.billNumber ? ` (${i.billNumber})` : ""}`, date: i.date, party: i.supplier.name, gstin: i.supplier.gstin, pos: i.supplier.stateCode, taxable: i.subtotal, cgst: i.cgst, sgst: i.sgst, igst: i.igst, total: i.total })),
    ...exp.map((i) => ({ id: i.id, href: `/expenses/${i.id}`, kind: `Expense · ${i.category.name}`, number: i.number, date: i.date, party: i.supplier?.name ?? "-", gstin: i.supplier?.gstin ?? null, pos: i.supplier?.stateCode ?? null, taxable: i.amount, cgst: i.cgst, sgst: i.sgst, igst: i.igst, total: i.total })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());
  return <Register rows={rows} filter={filter} />;
}

function Register({ rows, filter }: { rows: { id: string; href: string; kind: string; number: string; date: Date; party: string; gstin: string | null; pos: string | null; taxable: unknown; cgst: unknown; sgst: unknown; igst: unknown; total: unknown }[]; filter: React.ReactNode }) {
  const t = (k: "taxable" | "cgst" | "sgst" | "igst" | "total") => round2(rows.reduce((s, r) => s + num(r[k] as number), 0));
  return (
    <Card>
      {filter}
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        empty="No documents in this period"
        columns={[
          { key: "d", header: "Date", cell: (r) => formatDate(r.date) },
          { key: "n", header: "Document", cell: (r) => <div><Link className="text-navy-700 hover:underline" href={r.href}>{r.number}</Link><div className="text-xs text-slate-500">{r.kind}</div></div> },
          { key: "p", header: "Party", cell: (r) => r.party },
          { key: "g", header: "GSTIN", cell: (r) => <span className="font-mono text-xs">{r.gstin ?? "Unregistered"}</span> },
          { key: "pos", header: "POS", cell: (r) => r.pos },
          { key: "t", header: "Taxable", align: "right", cell: (r) => formatMoney(r.taxable as number) },
          { key: "c", header: "CGST", align: "right", cell: (r) => formatMoney(r.cgst as number) },
          { key: "s", header: "SGST", align: "right", cell: (r) => formatMoney(r.sgst as number) },
          { key: "i", header: "IGST", align: "right", cell: (r) => formatMoney(r.igst as number) },
          { key: "tot", header: "Invoice Value", align: "right", cell: (r) => formatMoney(r.total as number) },
        ]}
        footer={<tfoot><tr className="num border-t-2 border-slate-200 bg-slate-50 font-semibold"><td className="px-4 py-2" colSpan={5}>Total</td><td className="px-4 py-2 text-right">{formatMoney(t("taxable"))}</td><td className="px-4 py-2 text-right">{formatMoney(t("cgst"))}</td><td className="px-4 py-2 text-right">{formatMoney(t("sgst"))}</td><td className="px-4 py-2 text-right">{formatMoney(t("igst"))}</td><td className="px-4 py-2 text-right">{formatMoney(t("total"))}</td></tr></tfoot>}
      />
    </Card>
  );
}

async function Rates({ manage }: { manage: boolean }) {
  const rates = await prisma.gstRate.findMany({ orderBy: { rate: "asc" }, include: { _count: { select: { rates: true, inventoryItems: true } } } });
  return (
    <Card>
      {manage && (
        <div className="flex justify-end border-b border-slate-100 px-4 py-2">
          <FormDialog label="New GST Rate" icon={<Plus />} title="New GST rate">
            <EntityForm schemaKey="gstRate" cols={2} fields={gstRateFields()} defaultValues={{ active: true }} action={saveEntityAction.bind(null, "gstRate", null)} successMessage="GST rate created" />
          </FormDialog>
        </div>
      )}
      <DataTable
        rows={rates}
        rowKey={(r) => r.id}
        columns={[
          { key: "n", header: "Name", cell: (r) => r.name },
          { key: "r", header: "Rate", align: "right", cell: (r) => <b>{num(r.rate)}%</b> },
          { key: "split", header: "Intra-state split", cell: (r) => `CGST ${num(r.rate) / 2}% + SGST ${num(r.rate) / 2}%` },
          { key: "u", header: "Used by", cell: (r) => `${r._count.rates} contract rates · ${r._count.inventoryItems} materials` },
          { key: "a", header: "Status", cell: (r) => <Badge tone={r.active ? "green" : "grey"}>{r.active ? "Active" : "Inactive"}</Badge> },
          ...(manage
            ? [{ key: "e", header: "", cell: (r: (typeof rates)[number]) => (
                <div className="flex justify-end gap-1">
                  <FormDialog label="" icon={<Pencil />} variant="ghost" title={`Edit ${r.name}`} description="Changing a rate affects new invoices only; posted invoices keep the rate they used.">
                    <EntityForm schemaKey="gstRate" cols={2} fields={gstRateFields()} defaultValues={toFormValues(r)} action={saveEntityAction.bind(null, "gstRate", r.id)} successMessage="GST rate updated" />
                  </FormDialog>
                  <ActiveToggle entity="gstRate" id={r.id} active={r.active} label={r.name} />
                </div>
              ) }]
            : []),
        ]}
      />
    </Card>
  );
}

async function Settings({ manage }: { manage: boolean }) {
  const [s, rates] = await Promise.all([prisma.gstSetting.findFirst(), gstRateOptions()]);
  return (
    <Card><CardContent>
      {manage ? (
        <EntityForm
          schemaKey="gstSettings"
          cols={2}
          fields={[
            { name: "gstEnabled", label: "GST", type: "checkbox", help: "Charge GST on invoices (turn off only if the company is not GST-registered)" },
            { name: "roundOffInvoices", label: "Round off", type: "checkbox", help: "Round invoice totals to the nearest rupee" },
            { name: "defaultServiceSac", label: "Default SAC for services", required: true, help: "999432 = waste collection / treatment services" },
            { name: "defaultServiceRateId", label: "Default GST rate for services", type: "select", options: rates },
            { name: "defaultGoodsRateId", label: "Default GST rate for recyclable goods", type: "select", options: rates },
          ]}
          defaultValues={toFormValues(s)}
          action={gstSettingsAction}
          successMessage="GST settings saved"
        />
      ) : (
        <p className="text-sm text-slate-600">Only administrators can change GST settings.</p>
      )}
      <p className="mt-4 text-xs text-slate-500">Intra-state vs inter-state is decided per invoice by comparing the company state with the party&apos;s state (from GSTIN). Confirm applicable rates and SAC/HSN codes with your tax advisor.</p>
    </CardContent></Card>
  );
}
