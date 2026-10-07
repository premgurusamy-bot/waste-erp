import { FileDown } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { FilterBar, FilterField, FSelect, FText, LinkTabs, PageHeader, StatCard } from "@/components/ui/page";
import { str, type SP } from "@/lib/list-params";
import { formatDate, formatMoney, todayISO } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { customerOptions } from "@/server/options";
import { ageingRows, outstandingByCustomer } from "@/server/reports";

export const metadata = { title: "Customer Outstanding" };

export default async function OutstandingPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("receipts.view");
  const sp = await searchParams;
  const tab = str(sp, "tab") ?? "summary";
  const asOf = str(sp, "to") ?? todayISO();
  const customerId = str(sp, "customerId");
  const [summary, ageing, customers] = await Promise.all([outstandingByCustomer(asOf, customerId), ageingRows(asOf, customerId), customerOptions(true)]);
  const sum = (k: string) => ageing.reduce((s, r) => s + (r[k] as number), 0);
  const exportBase = `from=${asOf.slice(0, 4)}-01-01&to=${asOf}${customerId ? `&customerId=${customerId}` : ""}`;
  return (
    <>
      <PageHeader title="Customer Outstanding" description={`Receivables and ageing as on ${formatDate(asOf)}`} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total Outstanding" value={formatMoney(sum("balance"))} tone="navy" />
        <StatCard label="Current (not due)" value={formatMoney(sum("current"))} />
        <StatCard label="1–30 Days" value={formatMoney(sum("b30"))} tone="amber" />
        <StatCard label="31–60 Days" value={formatMoney(sum("b60"))} tone="amber" />
        <StatCard label="61–90 Days" value={formatMoney(sum("b90"))} tone="red" />
        <StatCard label="Above 90 Days" value={formatMoney(sum("b90p"))} tone="red" />
      </div>
      <LinkTabs base={`/outstanding?to=${asOf}${customerId ? `&customerId=${customerId}` : ""}`} active={tab} tabs={[{ key: "summary", label: "Customer-wise Outstanding" }, { key: "ageing", label: "Ageing (invoice-wise)" }]} />
      <Card>
        <FilterBar reset="/outstanding">
          <input type="hidden" name="tab" value={tab} />
          <FilterField label="As on"><FText type="date" name="to" defaultValue={asOf} /></FilterField>
          <FilterField label="Customer" className="min-w-56"><FSelect name="customerId" defaultValue={customerId} options={customers} /></FilterField>
          {(["xlsx", "pdf"] as const).map((f) => (
            <a key={f} href={`/api/reports/${tab === "summary" ? "customer-outstanding" : "ageing"}/export?format=${f}&${exportBase}`} className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm hover:bg-slate-50"><FileDown className="size-4" /> {f === "xlsx" ? "Excel" : "PDF"}</a>
          ))}
        </FilterBar>
        {tab === "summary" ? (
          <DataTable
            rows={summary}
            rowKey={(r) => String(r.customer)}
            empty="No outstanding balances"
            columns={[
              { key: "c", header: "Customer", cell: (r) => r.customer },
              { key: "i", header: "Open Invoices", align: "right", cell: (r) => r.invoices },
              { key: "inv", header: "Invoiced", align: "right", cell: (r) => formatMoney(r.invoiced) },
              { key: "rec", header: "Received", align: "right", cell: (r) => formatMoney(r.received) },
              { key: "bal", header: "Balance", align: "right", cell: (r) => <b>{formatMoney(r.balance)}</b> },
              { key: "od", header: "Overdue", align: "right", cell: (r) => <span className={(r.overdue as number) > 0 ? "text-red-600" : ""}>{formatMoney(r.overdue)}</span> },
              { key: "adv", header: "Advance", align: "right", cell: (r) => formatMoney(r.advance) },
            ]}
          />
        ) : (
          <DataTable
            rows={ageing}
            rowKey={(r) => String(r.invoice)}
            empty="No open invoices"
            columns={[
              { key: "i", header: "Invoice", cell: (r) => <Link className="text-navy-700 hover:underline" href={`/search?q=${r.invoice}`}>{r.invoice}</Link> },
              { key: "c", header: "Customer", cell: (r) => r.customer },
              { key: "d", header: "Date", cell: (r) => formatDate(String(r.date)) },
              { key: "due", header: "Due Date", cell: (r) => formatDate(String(r.dueDate)) },
              { key: "a", header: "Amount", align: "right", cell: (r) => formatMoney(r.amount) },
              { key: "rec", header: "Received", align: "right", cell: (r) => formatMoney(r.received) },
              { key: "bal", header: "Balance", align: "right", cell: (r) => <b>{formatMoney(r.balance)}</b> },
              { key: "age", header: "Age", align: "right", cell: (r) => ((r.age as number) > 0 ? <span className="text-red-600">{r.age} d</span> : "Current") },
              { key: "cur", header: "Current", align: "right", cell: (r) => (r.current ? formatMoney(r.current) : "") },
              { key: "b30", header: "1–30", align: "right", cell: (r) => (r.b30 ? formatMoney(r.b30) : "") },
              { key: "b60", header: "31–60", align: "right", cell: (r) => (r.b60 ? formatMoney(r.b60) : "") },
              { key: "b90", header: "61–90", align: "right", cell: (r) => (r.b90 ? formatMoney(r.b90) : "") },
              { key: "b90p", header: "> 90", align: "right", cell: (r) => (r.b90p ? formatMoney(r.b90p) : "") },
            ]}
          />
        )}
      </Card>
    </>
  );
}
