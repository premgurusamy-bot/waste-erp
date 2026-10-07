import { Plus } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { FilterBar, FilterField, FSelect, FText, PageHeader } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { opt } from "@/lib/fields";
import { ci, flat, listParams, str, type SP } from "@/lib/list-params";
import { dateOnly, formatDate, formatMoney, num, todayISO } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";

export const metadata = { title: "Purchases" };

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("purchases.view");
  const sp = await searchParams;
  const { page, pageSize, skip, take, q, status } = listParams(sp);
  const to = str(sp, "to") ?? todayISO();
  const from = str(sp, "from") ?? `${to.slice(0, 4)}-01-01`;
  const where = {
    date: { gte: dateOnly(from), lte: dateOnly(to) },
    ...(q ? { OR: [{ number: ci(q) }, { billNumber: ci(q) }, { supplier: { name: ci(q) } }] } : {}),
    ...(status ? { paymentStatus: status as any, status: "POSTED" as const } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.purchase.findMany({ where, include: { supplier: true }, orderBy: [{ date: "desc" }, { number: "desc" }], skip, take }),
    prisma.purchase.count({ where }),
  ]);
  return (
    <>
      <PageHeader title="Purchases" description="Supplier bills for materials, scrap and supplies" actions={user.permissions.includes("purchases.manage") && <Button asChild><Link href="/purchases/new"><Plus /> New Purchase</Link></Button>} />
      <Card>
        <FilterBar reset="/purchases">
          <FilterField label="Search" className="min-w-48 flex-1"><FText name="q" defaultValue={q} placeholder="Purchase no., bill no., supplier" /></FilterField>
          <FilterField label="Payment"><FSelect name="status" defaultValue={status} options={opt(["UNPAID", "PARTIAL", "PAID"])} /></FilterField>
          <FilterField label="From"><FText type="date" name="from" defaultValue={from} /></FilterField>
          <FilterField label="To"><FText type="date" name="to" defaultValue={to} /></FilterField>
        </FilterBar>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          empty="No purchases in this period"
          columns={[
            { key: "n", header: "Purchase No.", cell: (r) => <Link href={`/purchases/${r.id}`} className="font-medium text-navy-700 hover:underline">{r.number}</Link> },
            { key: "d", header: "Date", cell: (r) => formatDate(r.date) },
            { key: "s", header: "Supplier", cell: (r) => r.supplier.name },
            { key: "b", header: "Bill No.", cell: (r) => r.billNumber },
            { key: "t", header: "Taxable", align: "right", cell: (r) => formatMoney(r.subtotal) },
            { key: "g", header: "GST", align: "right", cell: (r) => formatMoney(num(r.cgst) + num(r.sgst) + num(r.igst)) },
            { key: "tot", header: "Total", align: "right", cell: (r) => <b>{formatMoney(r.total)}</b> },
            { key: "p", header: "Paid", align: "right", cell: (r) => formatMoney(r.amountPaid) },
            { key: "st", header: "Payment", cell: (r) => <StatusBadge status={r.status === "CANCELLED" ? "CANCELLED" : r.paymentStatus} /> },
          ]}
        />
        <Pagination page={page} pageSize={pageSize} total={total} params={flat(sp)} />
      </Card>
    </>
  );
}
