import { Plus } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { FilterBar, FilterField, FText, PageHeader, StatCard } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { ci, flat, listParams, str, type SP } from "@/lib/list-params";
import { dateOnly, formatDate, formatMoney, num, round2, titleCase, todayISO } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";

export const metadata = { title: "Supplier Payments" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("receipts.view");
  const sp = await searchParams;
  const { page, pageSize, skip, take, q } = listParams(sp);
  const to = str(sp, "to") ?? todayISO();
  const from = str(sp, "from") ?? `${to.slice(0, 4)}-01-01`;
  const where = { date: { gte: dateOnly(from), lte: dateOnly(to) }, ...(q ? { OR: [{ number: ci(q) }, { reference: ci(q) }, { supplier: { name: ci(q) } }] } : {}) };
  const [rows, total, agg, payPur, payExp] = await Promise.all([
    prisma.payment.findMany({ where, include: { supplier: true, account: true }, orderBy: [{ date: "desc" }, { number: "desc" }], skip, take }),
    prisma.payment.count({ where }),
    prisma.payment.aggregate({ where: { ...where, status: "POSTED" }, _sum: { amount: true } }),
    prisma.purchase.aggregate({ where: { status: "POSTED" }, _sum: { total: true, amountPaid: true } }),
    prisma.expense.aggregate({ where: { status: "POSTED", paymentMode: "CREDIT" }, _sum: { total: true, amountPaid: true } }),
  ]);
  const payable = round2(num(payPur._sum.total) - num(payPur._sum.amountPaid) + num(payExp._sum.total) - num(payExp._sum.amountPaid));
  return (
    <>
      <PageHeader title="Supplier Payments" description="Payments against purchases and credit expenses" actions={user.permissions.includes("receipts.manage") && <Button asChild><Link href="/payments/new"><Plus /> New Payment</Link></Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3">
        <StatCard label="Paid in Period" value={formatMoney(agg._sum.amount)} tone="navy" />
        <StatCard label="Total Payables (all time)" value={formatMoney(payable)} tone="amber" />
      </div>
      <Card>
        <FilterBar reset="/payments">
          <FilterField label="Search" className="min-w-48 flex-1"><FText name="q" defaultValue={q} placeholder="Payment no., reference, supplier" /></FilterField>
          <FilterField label="From"><FText type="date" name="from" defaultValue={from} /></FilterField>
          <FilterField label="To"><FText type="date" name="to" defaultValue={to} /></FilterField>
        </FilterBar>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          empty="No payments in this period"
          columns={[
            { key: "n", header: "Payment", cell: (r) => <Link href={`/payments/${r.id}`} className="font-medium text-navy-700 hover:underline">{r.number}</Link> },
            { key: "d", header: "Date", cell: (r) => formatDate(r.date) },
            { key: "s", header: "Supplier", cell: (r) => r.supplier.name },
            { key: "m", header: "Mode", cell: (r) => titleCase(r.mode) },
            { key: "ref", header: "Reference", cell: (r) => r.reference },
            { key: "acc", header: "Paid From", hideOnMobile: true, cell: (r) => r.account.name },
            { key: "a", header: "Amount", align: "right", cell: (r) => <b>{formatMoney(r.amount)}</b> },
            { key: "st", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
        <Pagination page={page} pageSize={pageSize} total={total} params={flat(sp)} />
      </Card>
    </>
  );
}
