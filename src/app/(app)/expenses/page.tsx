import { Plus } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { FilterBar, FilterField, FSelect, FText, PageHeader, StatCard } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { ci, flat, listParams, str, type SP } from "@/lib/list-params";
import { dateOnly, formatDate, formatMoney, num, titleCase, todayISO } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { expenseCategoryOptions, vehicleOptions } from "@/server/options";

export const metadata = { title: "Expenses" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("expenses.view");
  const sp = await searchParams;
  const { page, pageSize, skip, take, q } = listParams(sp);
  const to = str(sp, "to") ?? todayISO();
  const from = str(sp, "from") ?? `${to.slice(0, 7)}-01`;
  const categoryId = str(sp, "categoryId");
  const vehicleId = str(sp, "vehicleId");
  const where = {
    date: { gte: dateOnly(from), lte: dateOnly(to) },
    ...(q ? { OR: [{ number: ci(q) }, { description: ci(q) }, { reference: ci(q) }, { supplier: { name: ci(q) } }] } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(vehicleId ? { vehicleId } : {}),
  };
  const [rows, total, byCat, cats, vehicles] = await Promise.all([
    prisma.expense.findMany({ where, include: { category: true, supplier: true, vehicle: true }, orderBy: [{ date: "desc" }, { number: "desc" }], skip, take }),
    prisma.expense.count({ where }),
    prisma.expense.groupBy({ by: ["categoryId"], where: { ...where, status: "POSTED" }, _sum: { amount: true } }),
    expenseCategoryOptions(),
    vehicleOptions(true),
  ]);
  const catName = new Map(cats.map((c) => [c.value, c.label]));
  const top = byCat.sort((a, b) => num(b._sum.amount) - num(a._sum.amount)).slice(0, 3);
  return (
    <>
      <PageHeader title="Expenses" description="Operating expenses by category (fuel and maintenance are recorded from Vehicles)" actions={user.permissions.includes("expenses.manage") && <Button asChild><Link href="/expenses/new"><Plus /> New Expense</Link></Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total (excl. GST)" value={formatMoney(byCat.reduce((s, c) => s + num(c._sum.amount), 0))} tone="red" />
        {top.map((c) => <StatCard key={c.categoryId} label={catName.get(c.categoryId) ?? ""} value={formatMoney(c._sum.amount)} tone="slate" />)}
      </div>
      <Card>
        <FilterBar reset="/expenses">
          <FilterField label="Search" className="min-w-48 flex-1"><FText name="q" defaultValue={q} placeholder="Expense no., description, supplier" /></FilterField>
          <FilterField label="Category"><FSelect name="categoryId" defaultValue={categoryId} options={cats} /></FilterField>
          <FilterField label="Vehicle"><FSelect name="vehicleId" defaultValue={vehicleId} options={vehicles} /></FilterField>
          <FilterField label="From"><FText type="date" name="from" defaultValue={from} /></FilterField>
          <FilterField label="To"><FText type="date" name="to" defaultValue={to} /></FilterField>
        </FilterBar>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          empty="No expenses in this period"
          columns={[
            { key: "n", header: "Expense No.", cell: (r) => <Link href={`/expenses/${r.id}`} className="font-medium text-navy-700 hover:underline">{r.number}</Link> },
            { key: "d", header: "Date", cell: (r) => formatDate(r.date) },
            { key: "c", header: "Category", cell: (r) => r.category.name },
            { key: "desc", header: "Description", cell: (r) => <div><div>{r.description}</div><div className="text-xs text-slate-500">{[r.supplier?.name, r.vehicle?.number].filter(Boolean).join(" · ")}</div></div> },
            { key: "a", header: "Amount", align: "right", cell: (r) => formatMoney(r.amount) },
            { key: "g", header: "GST", align: "right", cell: (r) => formatMoney(num(r.cgst) + num(r.sgst) + num(r.igst)) },
            { key: "t", header: "Total", align: "right", cell: (r) => <b>{formatMoney(r.total)}</b> },
            { key: "m", header: "Mode", cell: (r) => titleCase(r.paymentMode) },
            { key: "s", header: "Status", cell: (r) => <StatusBadge status={r.status === "CANCELLED" ? "CANCELLED" : r.paymentStatus} /> },
          ]}
        />
        <Pagination page={page} pageSize={pageSize} total={total} params={flat(sp)} />
      </Card>
    </>
  );
}
