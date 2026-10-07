import { Plus } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { FilterBar, FilterField, FSelect, FText, PageHeader } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { ci, flat, listParams, str, type SP } from "@/lib/list-params";
import { titleCase } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { customerOptions } from "@/server/options";

export const metadata = { title: "Customer Sites" };

export default async function SitesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("customers.view");
  const sp = await searchParams;
  const { page, pageSize, skip, take, q, status } = listParams(sp);
  const customerId = str(sp, "customerId");
  const where = {
    ...(q ? { OR: [{ name: ci(q) }, { code: ci(q) }, { address: ci(q) }] } : {}),
    ...(status ? { status: status as any } : {}),
    ...(customerId ? { customerId } : {}),
  };
  const [rows, total, customers] = await Promise.all([
    prisma.customerSite.findMany({ where, include: { customer: true, defaultWasteType: true }, orderBy: [{ customer: { name: "asc" } }, { name: "asc" }], skip, take }),
    prisma.customerSite.count({ where }),
    customerOptions(true),
  ]);
  return (
    <>
      <PageHeader title="Customer Sites" description="Collection points with frequency and timing" actions={user.permissions.includes("customers.manage") && <Button asChild><Link href="/sites/new"><Plus /> New Site</Link></Button>} />
      <Card>
        <FilterBar reset="/sites">
          <FilterField label="Search" className="min-w-56 flex-1"><FText name="q" defaultValue={q} placeholder="Site name, code, address" /></FilterField>
          <FilterField label="Customer"><FSelect name="customerId" defaultValue={customerId} options={customers} /></FilterField>
          <FilterField label="Status"><FSelect name="status" defaultValue={status} options={[{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }]} /></FilterField>
        </FilterBar>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          empty="No sites found"
          columns={[
            { key: "code", header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
            { key: "name", header: "Site", cell: (r) => <Link href={`/sites/${r.id}`} className="font-medium text-navy-700 hover:underline">{r.name}</Link> },
            { key: "cust", header: "Customer", cell: (r) => <Link href={`/customers/${r.customerId}`} className="hover:underline">{r.customer.name}</Link> },
            { key: "addr", header: "Address", hideOnMobile: true, cell: (r) => r.address },
            { key: "wt", header: "Waste Type", cell: (r) => r.defaultWasteType?.name },
            { key: "freq", header: "Frequency", cell: (r) => titleCase(r.frequency) },
            { key: "time", header: "Timing", cell: (r) => r.collectionTime },
            { key: "gps", header: "GPS", hideOnMobile: true, cell: (r) => (r.latitude ? <a className="text-xs text-brand-700 hover:underline" target="_blank" href={`https://maps.google.com/?q=${r.latitude},${r.longitude}`}>Map</a> : "") },
            { key: "st", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
        <Pagination page={page} pageSize={pageSize} total={total} params={flat(sp)} />
      </Card>
    </>
  );
}
