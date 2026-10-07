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
import { dateOnly, formatDate, formatMoney, formatQty, num, todayISO } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { buyerOptions } from "@/server/options";

export const metadata = { title: "Recyclable Sales" };

export default async function SalesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("sales.view");
  const sp = await searchParams;
  const { page, pageSize, skip, take, q, status } = listParams(sp);
  const to = str(sp, "to") ?? todayISO();
  const from = str(sp, "from") ?? `${to.slice(0, 4)}-01-01`;
  const buyerId = str(sp, "buyerId");
  const where = {
    date: { gte: dateOnly(from), lte: dateOnly(to) },
    ...(q ? { OR: [{ number: ci(q) }, { buyer: { name: ci(q) } }] } : {}),
    ...(status ? { paymentStatus: status as any, status: "POSTED" as const } : {}),
    ...(buyerId ? { buyerId } : {}),
  };
  const [rows, total, agg, qtyAgg, buyers] = await Promise.all([
    prisma.salesInvoice.findMany({ where, include: { buyer: true, items: { include: { item: true } } }, orderBy: [{ date: "desc" }, { number: "desc" }], skip, take }),
    prisma.salesInvoice.count({ where }),
    prisma.salesInvoice.aggregate({ where: { ...where, status: "POSTED" }, _sum: { subtotal: true, total: true, amountReceived: true } }),
    prisma.salesInvoiceItem.aggregate({ where: { salesInvoice: { ...where, status: "POSTED" } }, _sum: { quantity: true } }),
    buyerOptions(),
  ]);
  return (
    <>
      <PageHeader title="Recyclable Sales" description="Sale of recovered material to buyers; stock is reduced automatically" actions={user.permissions.includes("sales.manage") && <Button asChild><Link href="/sales/new"><Plus /> New Sale</Link></Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Quantity Sold" value={`${formatQty(qtyAgg._sum.quantity)} kg`} tone="navy" />
        <StatCard label="Taxable Value" value={formatMoney(agg._sum.subtotal)} />
        <StatCard label="Invoice Total" value={formatMoney(agg._sum.total)} tone="slate" />
        <StatCard label="Receivable" value={formatMoney(num(agg._sum.total) - num(agg._sum.amountReceived))} tone="amber" />
      </div>
      <Card>
        <FilterBar reset="/sales">
          <FilterField label="Search" className="min-w-48 flex-1"><FText name="q" defaultValue={q} placeholder="Invoice no., buyer" /></FilterField>
          <FilterField label="Buyer"><FSelect name="buyerId" defaultValue={buyerId} options={buyers} /></FilterField>
          <FilterField label="Payment"><FSelect name="status" defaultValue={status} options={opt(["UNPAID", "PARTIAL", "PAID"])} /></FilterField>
          <FilterField label="From"><FText type="date" name="from" defaultValue={from} /></FilterField>
          <FilterField label="To"><FText type="date" name="to" defaultValue={to} /></FilterField>
        </FilterBar>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          empty="No sales in this period"
          columns={[
            { key: "n", header: "Invoice", cell: (r) => <Link href={`/sales/${r.id}`} className="font-medium text-navy-700 hover:underline">{r.number}</Link> },
            { key: "d", header: "Date", cell: (r) => formatDate(r.date) },
            { key: "b", header: "Buyer", cell: (r) => r.buyer.name },
            { key: "m", header: "Material", hideOnMobile: true, cell: (r) => r.items.map((i) => `${i.item.name.replace("Recovered ", "")} ${formatQty(i.quantity)}kg`).join(", ") },
            { key: "t", header: "Taxable", align: "right", cell: (r) => formatMoney(r.subtotal) },
            { key: "g", header: "GST", align: "right", cell: (r) => formatMoney(num(r.cgst) + num(r.sgst) + num(r.igst)) },
            { key: "tot", header: "Total", align: "right", cell: (r) => <b>{formatMoney(r.total)}</b> },
            { key: "s", header: "Payment", cell: (r) => <StatusBadge status={r.status === "CANCELLED" ? "CANCELLED" : r.paymentStatus} /> },
          ]}
        />
        <Pagination page={page} pageSize={pageSize} total={total} params={flat(sp)} />
      </Card>
    </>
  );
}
