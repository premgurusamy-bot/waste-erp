import { Camera, Plus, Scale } from "lucide-react";
import Link from "next/link";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { FilterBar, FilterField, FSelect, FText, PageHeader } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { opt } from "@/lib/fields";
import { ci, flat, listParams, str, type SP } from "@/lib/list-params";
import { formatDateTime, formatQty, localDayRange, todayISO } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { customerOptions, vehicleOptions } from "@/server/options";

export const metadata = { title: "Collections" };

export default async function CollectionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("collections.view");
  const sp = await searchParams;
  const { page, pageSize, skip, take, q, status } = listParams(sp);
  const to = str(sp, "to") ?? todayISO();
  const from = str(sp, "from") ?? `${to.slice(0, 7)}-01`;
  const customerId = str(sp, "customerId");
  const vehicleId = str(sp, "vehicleId");
  const where = {
    collectionDate: localDayRange(from, to),
    ...(q ? { OR: [{ number: ci(q) }, { customer: { name: ci(q) } }, { site: { name: ci(q) } }] } : {}),
    ...(status ? { status: status as any } : {}),
    ...(customerId ? { customerId } : {}),
    ...(vehicleId ? { vehicleId } : {}),
  };
  const [rows, total, customers, vehicles] = await Promise.all([
    prisma.collectionEntry.findMany({ where, include: { customer: true, site: true, vehicle: true, driver: true, wasteType: true, weighment: true }, orderBy: { collectionDate: "desc" }, skip, take }),
    prisma.collectionEntry.count({ where }),
    customerOptions(true),
    vehicleOptions(true),
  ]);
  const manage = user.permissions.includes("collections.manage");
  const weigh = user.permissions.includes("weighments.manage");
  return (
    <>
      <PageHeader title="Collections" description="Waste collected at customer sites" actions={manage && <Button asChild><Link href="/collections/new"><Plus /> Record Collection</Link></Button>} />
      <Card>
        <FilterBar reset="/collections">
          <FilterField label="Search" className="min-w-48 flex-1"><FText name="q" defaultValue={q} placeholder="Collection no., customer, site" /></FilterField>
          <FilterField label="Customer"><FSelect name="customerId" defaultValue={customerId} options={customers} /></FilterField>
          <FilterField label="Vehicle"><FSelect name="vehicleId" defaultValue={vehicleId} options={vehicles} /></FilterField>
          <FilterField label="Status"><FSelect name="status" defaultValue={status} options={opt(["COMPLETED", "PARTIAL", "NOT_COLLECTED"])} /></FilterField>
          <FilterField label="From"><FText type="date" name="from" defaultValue={from} /></FilterField>
          <FilterField label="To"><FText type="date" name="to" defaultValue={to} /></FilterField>
        </FilterBar>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          empty="No collections in this period"
          columns={[
            { key: "n", header: "Collection", cell: (r) => <span className="font-mono text-xs font-medium">{r.number}</span> },
            { key: "d", header: "Date / Time", cell: (r) => formatDateTime(r.collectionDate) },
            { key: "c", header: "Customer / Site", cell: (r) => <div><div className="font-medium">{r.customer.name}</div><div className="text-xs text-slate-500">{r.site.name}</div></div> },
            { key: "w", header: "Waste", cell: (r) => r.wasteType.name },
            { key: "v", header: "Vehicle / Driver", hideOnMobile: true, cell: (r) => <div><div>{r.vehicle.number}</div><div className="text-xs text-slate-500">{r.driver?.name}</div></div> },
            { key: "e", header: "Est. (KG)", align: "right", hideOnMobile: true, cell: (r) => formatQty(r.estimatedQty) },
            { key: "a", header: "Actual (KG)", align: "right", cell: (r) => formatQty(r.actualQty) },
            { key: "ph", header: "Photo", cell: (r) => (r.photoDocumentId ? <a href={`/api/documents/${r.photoDocumentId}`} target="_blank" className="text-brand-700" aria-label="View photo"><Camera className="size-4" /></a> : null) },
            { key: "s", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
            {
              key: "wt",
              header: "Weighment",
              cell: (r) =>
                r.weighment ? (
                  <Link href={`/weighments/${r.weighment.id}`} className="text-xs text-navy-700 hover:underline">{r.weighment.number}</Link>
                ) : weigh && r.status !== "NOT_COLLECTED" ? (
                  <Button size="sm" variant="outline" asChild><Link href={`/weighments/new?collectionId=${r.id}`}><Scale /> Gate In</Link></Button>
                ) : (
                  <Badge>Pending</Badge>
                ),
            },
          ]}
        />
        <Pagination page={page} pageSize={pageSize} total={total} params={flat(sp)} />
      </Card>
    </>
  );
}
