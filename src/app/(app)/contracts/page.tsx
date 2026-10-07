import { Plus } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { FilterBar, FilterField, FSelect, FText, PageHeader } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { ci, flat, listParams, type SP } from "@/lib/list-params";
import { opt } from "@/lib/fields";
import { formatDate, formatMoney, titleCase } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";

export const metadata = { title: "Contracts & Rates" };

export default async function ContractsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("contracts.view");
  const sp = await searchParams;
  const { page, pageSize, skip, take, q, status } = listParams(sp);
  const where = {
    ...(q ? { OR: [{ number: ci(q) }, { title: ci(q) }, { customer: { name: ci(q) } }] } : {}),
    ...(status ? { status: status as any } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.contract.findMany({ where, include: { customer: true, rates: { where: { status: "ACTIVE" } } }, orderBy: { createdAt: "desc" }, skip, take }),
    prisma.contract.count({ where }),
  ]);
  return (
    <>
      <PageHeader title="Contracts & Rates" description="Customer-specific commercial terms with versioned rates" actions={user.permissions.includes("contracts.manage") && <Button asChild><Link href="/contracts/new"><Plus /> New Contract</Link></Button>} />
      <Card>
        <FilterBar reset="/contracts">
          <FilterField label="Search" className="min-w-64 flex-1"><FText name="q" defaultValue={q} placeholder="Contract no., title, customer" /></FilterField>
          <FilterField label="Status"><FSelect name="status" defaultValue={status} options={opt(["DRAFT", "ACTIVE", "EXPIRED", "TERMINATED"])} /></FilterField>
        </FilterBar>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          empty="No contracts"
          columns={[
            { key: "n", header: "Contract", cell: (r) => <Link href={`/contracts/${r.id}`} className="font-medium text-navy-700 hover:underline">{r.number}</Link> },
            { key: "c", header: "Customer", cell: (r) => r.customer.name },
            { key: "t", header: "Title", hideOnMobile: true, cell: (r) => r.title },
            { key: "p", header: "Period", cell: (r) => `${formatDate(r.startDate)} – ${r.endDate ? formatDate(r.endDate) : "Open"}` },
            { key: "r", header: "Current Rates", cell: (r) => r.rates.map((x) => `${titleCase(x.billingMethod)}: ${formatMoney(x.rate)}/${x.unit.toLowerCase()}`).join("; ") },
            { key: "terms", header: "Terms", align: "right", cell: (r) => `${r.paymentTermsDays} d` },
            { key: "s", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
        <Pagination page={page} pageSize={pageSize} total={total} params={flat(sp)} />
      </Card>
    </>
  );
}
