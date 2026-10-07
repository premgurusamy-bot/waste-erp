import { Plus } from "lucide-react";
import Link from "next/link";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { FilterBar, FilterField, FSelect, FText, PageHeader, StatCard } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { ci, flat, listParams, str, type SP } from "@/lib/list-params";
import { dateOnly, formatDate, formatMoney, num, titleCase, todayISO } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";

export const metadata = { title: "Receipts" };

export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("receipts.view");
  const sp = await searchParams;
  const { page, pageSize, skip, take, q } = listParams(sp);
  const to = str(sp, "to") ?? todayISO();
  const from = str(sp, "from") ?? `${to.slice(0, 7)}-01`;
  const partyType = str(sp, "partyType");
  const where = {
    date: { gte: dateOnly(from), lte: dateOnly(to) },
    ...(q ? { OR: [{ number: ci(q) }, { reference: ci(q) }, { customer: { name: ci(q) } }, { buyer: { name: ci(q) } }] } : {}),
    ...(partyType ? { partyType: partyType as any } : {}),
  };
  const [rows, total, agg] = await Promise.all([
    prisma.receipt.findMany({ where, include: { customer: true, buyer: true, account: true }, orderBy: [{ date: "desc" }, { number: "desc" }], skip, take }),
    prisma.receipt.count({ where }),
    prisma.receipt.aggregate({ where: { ...where, status: "POSTED" }, _sum: { amount: true, allocatedAmount: true }, _count: true }),
  ]);
  return (
    <>
      <PageHeader title="Receipts" description="Payments received from customers and recyclable buyers" actions={user.permissions.includes("receipts.manage") && <Button asChild><Link href="/receipts/new"><Plus /> New Receipt</Link></Button>} />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <StatCard label="Receipts" value={agg._count} tone="navy" />
        <StatCard label="Amount Received" value={formatMoney(agg._sum.amount)} />
        <StatCard label="Unallocated Advances" value={formatMoney(num(agg._sum.amount) - num(agg._sum.allocatedAmount))} tone="amber" />
      </div>
      <Card>
        <FilterBar reset="/receipts">
          <FilterField label="Search" className="min-w-48 flex-1"><FText name="q" defaultValue={q} placeholder="Receipt no., reference, party" /></FilterField>
          <FilterField label="Party"><FSelect name="partyType" defaultValue={partyType} options={[{ value: "CUSTOMER", label: "Customers" }, { value: "BUYER", label: "Buyers" }]} /></FilterField>
          <FilterField label="From"><FText type="date" name="from" defaultValue={from} /></FilterField>
          <FilterField label="To"><FText type="date" name="to" defaultValue={to} /></FilterField>
        </FilterBar>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          empty="No receipts in this period"
          columns={[
            { key: "n", header: "Receipt", cell: (r) => <Link href={`/receipts/${r.id}`} className="font-medium text-navy-700 hover:underline">{r.number}</Link> },
            { key: "d", header: "Date", cell: (r) => formatDate(r.date) },
            { key: "p", header: "Received From", cell: (r) => <div>{r.customer?.name ?? r.buyer?.name} <Badge tone={r.partyType === "CUSTOMER" ? "blue" : "purple"}>{titleCase(r.partyType)}</Badge></div> },
            { key: "m", header: "Mode", cell: (r) => titleCase(r.mode) },
            { key: "ref", header: "Reference", hideOnMobile: true, cell: (r) => r.reference },
            { key: "acc", header: "Account", hideOnMobile: true, cell: (r) => r.account.name },
            { key: "a", header: "Amount", align: "right", cell: (r) => <b>{formatMoney(r.amount)}</b> },
            { key: "u", header: "Unallocated", align: "right", cell: (r) => formatMoney(num(r.amount) - num(r.allocatedAmount)) },
            { key: "s", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
        <Pagination page={page} pageSize={pageSize} total={total} params={flat(sp)} />
      </Card>
    </>
  );
}
