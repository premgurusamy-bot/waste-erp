import { Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { FilterBar, FilterField, FSelect, FText, PageHeader } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { ci, flat, listParams, type SP } from "@/lib/list-params";
import { formatMoney, num, round2 } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("customers.view");
  const sp = await searchParams;
  const { page, pageSize, skip, take, q, status } = listParams(sp);
  const where = {
    ...(q ? { OR: [{ name: ci(q) }, { code: ci(q) }, { gstin: ci(q) }, { mobile: ci(q) }, { city: ci(q) }] } : {}),
    ...(status ? { status: status as any } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.customer.findMany({ where, orderBy: { name: "asc" }, skip, take, include: { _count: { select: { sites: true } } } }),
    prisma.customer.count({ where }),
  ]);
  const balances = await prisma.customerInvoice.groupBy({
    by: ["customerId"],
    where: { customerId: { in: rows.map((r) => r.id) }, status: "POSTED" },
    _sum: { total: true, amountReceived: true },
  });
  const bal = new Map(balances.map((b) => [b.customerId, round2(num(b._sum.total) - num(b._sum.amountReceived))]));
  const canManage = user.permissions.includes("customers.manage");
  return (
    <>
      <PageHeader
        title="Customers"
        description="Waste generators served under contract"
        actions={canManage && <Button asChild><Link href="/customers/new"><Plus /> New Customer</Link></Button>}
      />
      <Card>
        <FilterBar reset="/customers">
          <FilterField label="Search" className="min-w-64 flex-1"><FText name="q" defaultValue={q} placeholder="Name, code, GSTIN, mobile, city" /></FilterField>
          <FilterField label="Status"><FSelect name="status" defaultValue={status} options={[{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }]} /></FilterField>
        </FilterBar>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          empty="No customers found"
          emptyHint={canManage ? <Link href="/customers/new" className="text-brand-700 underline">Add the first customer</Link> : undefined}
          columns={[
            { key: "code", header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
            { key: "name", header: "Customer", cell: (r) => <Link href={`/customers/${r.id}`} className="font-medium text-navy-700 hover:underline">{r.name}</Link> },
            { key: "gstin", header: "GSTIN", hideOnMobile: true, cell: (r) => <span className="font-mono text-xs">{r.gstin}</span> },
            { key: "contact", header: "Contact", hideOnMobile: true, cell: (r) => <div><div>{r.contactPerson}</div><div className="text-xs text-slate-500">{r.mobile}</div></div> },
            { key: "city", header: "City", hideOnMobile: true, cell: (r) => r.city },
            { key: "sites", header: "Sites", align: "right", cell: (r) => r._count.sites },
            { key: "credit", header: "Credit", align: "right", hideOnMobile: true, cell: (r) => `${r.creditDays} d` },
            { key: "out", header: "Outstanding", align: "right", cell: (r) => <span className={(bal.get(r.id) ?? 0) > 0 ? "font-medium text-amber-700" : "text-slate-400"}>{formatMoney(bal.get(r.id) ?? 0)}</span> },
            { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
        <Pagination page={page} pageSize={pageSize} total={total} params={flat(sp)} />
      </Card>
    </>
  );
}
