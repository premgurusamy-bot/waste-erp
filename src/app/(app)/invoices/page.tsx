import { Plus } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { FilterBar, FilterField, FSelect, FText, PageHeader, StatCard } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { opt } from "@/lib/fields";
import { ci, flat, listParams, str, type SP } from "@/lib/list-params";
import { dateOnly, formatDate, formatMoney, num, todayISO } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { customerOptions } from "@/server/options";

export const metadata = { title: "Billing & Invoices" };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("billing.view");
  const sp = await searchParams;
  const { page, pageSize, skip, take, q, status } = listParams(sp);
  const to = str(sp, "to") ?? todayISO();
  const from = str(sp, "from") ?? `${to.slice(0, 4)}-01-01`;
  const customerId = str(sp, "customerId");
  const where = {
    date: { gte: dateOnly(from), lte: dateOnly(to) },
    ...(q ? { OR: [{ number: ci(q) }, { customer: { name: ci(q) } }] } : {}),
    ...(status === "CANCELLED" ? { status: "CANCELLED" as const } : status ? { paymentStatus: status as any, status: "POSTED" as const } : {}),
    ...(customerId ? { customerId } : {}),
  };
  const [rows, total, agg, customers] = await Promise.all([
    prisma.customerInvoice.findMany({ where, include: { customer: true, site: true }, orderBy: [{ date: "desc" }, { number: "desc" }], skip, take }),
    prisma.customerInvoice.count({ where }),
    prisma.customerInvoice.aggregate({ where: { ...where, status: "POSTED" }, _sum: { subtotal: true, total: true, amountReceived: true }, _count: true }),
    customerOptions(true),
  ]);
  return (
    <>
      <PageHeader title="Billing & Invoices" description="Customer service invoices generated from weighments, trips and monthly contracts" actions={user.permissions.includes("billing.manage") && <Button asChild><Link href="/invoices/new"><Plus /> Generate Invoice</Link></Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Invoices" value={agg._count} tone="navy" />
        <StatCard label="Taxable Billing" value={formatMoney(agg._sum.subtotal)} />
        <StatCard label="Received" value={formatMoney(agg._sum.amountReceived)} tone="slate" />
        <StatCard label="Outstanding" value={formatMoney(num(agg._sum.total) - num(agg._sum.amountReceived))} tone="amber" />
      </div>
      <Card>
        <FilterBar reset="/invoices">
          <FilterField label="Search" className="min-w-48 flex-1"><FText name="q" defaultValue={q} placeholder="Invoice no., customer" /></FilterField>
          <FilterField label="Customer"><FSelect name="customerId" defaultValue={customerId} options={customers} /></FilterField>
          <FilterField label="Status"><FSelect name="status" defaultValue={status} options={opt(["UNPAID", "PARTIAL", "PAID", "CANCELLED"])} /></FilterField>
          <FilterField label="From"><FText type="date" name="from" defaultValue={from} /></FilterField>
          <FilterField label="To"><FText type="date" name="to" defaultValue={to} /></FilterField>
        </FilterBar>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          empty="No invoices in this period"
          columns={[
            { key: "n", header: "Invoice", cell: (r) => <Link href={`/invoices/${r.id}`} className="font-medium text-navy-700 hover:underline">{r.number}</Link> },
            { key: "d", header: "Date", cell: (r) => formatDate(r.date) },
            { key: "c", header: "Customer", cell: (r) => <div><div>{r.customer.name}</div>{r.site && <div className="text-xs text-slate-500">{r.site.name}</div>}</div> },
            { key: "p", header: "Billing Period", hideOnMobile: true, cell: (r) => (r.periodFrom ? `${formatDate(r.periodFrom)} – ${formatDate(r.periodTo)}` : "") },
            { key: "t", header: "Taxable", align: "right", cell: (r) => formatMoney(r.subtotal) },
            { key: "tot", header: "Total", align: "right", cell: (r) => <b>{formatMoney(r.total)}</b> },
            { key: "b", header: "Balance", align: "right", cell: (r) => formatMoney(r.status === "CANCELLED" ? 0 : num(r.total) - num(r.amountReceived)) },
            { key: "due", header: "Due", cell: (r) => formatDate(r.dueDate) },
            { key: "s", header: "Status", cell: (r) => <StatusBadge status={r.status === "CANCELLED" ? "CANCELLED" : r.paymentStatus} /> },
          ]}
        />
        <Pagination page={page} pageSize={pageSize} total={total} params={flat(sp)} />
      </Card>
    </>
  );
}
