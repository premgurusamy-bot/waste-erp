import { Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActiveToggle } from "@/components/shared/active-toggle";
import { DocumentsPanel } from "@/components/shared/documents-panel";
import { ExpiryCell } from "@/components/shared/expiry";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { DetailGrid, PageHeader, Section, StatCard } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime, formatQty, formatTonnes } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";

export default async function DriverPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("drivers.view");
  const { id } = await params;
  const d = await prisma.driver.findUnique({ where: { id }, include: { defaultForVehicles: true } });
  if (!d) notFound();
  const [trips, missed, agg, recent] = await Promise.all([
    prisma.collectionEntry.count({ where: { driverId: id, status: { not: "NOT_COLLECTED" } } }),
    prisma.collectionEntry.count({ where: { driverId: id, status: "NOT_COLLECTED" } }),
    prisma.weighment.aggregate({ where: { driverId: id, status: "COMPLETED" }, _sum: { netWeight: true }, _count: true }),
    prisma.collectionEntry.findMany({ where: { driverId: id }, include: { customer: true, site: true, vehicle: true, wasteType: true }, orderBy: { collectionDate: "desc" }, take: 20 }),
  ]);
  const manage = user.permissions.includes("drivers.manage");
  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2">{d.name} <StatusBadge status={d.status} /></span>}
        description={`${d.code} · ${d.mobile ?? ""}`}
        crumbs={[{ href: "/drivers", label: "Drivers" }]}
        actions={manage && (<><Button variant="outline" size="sm" asChild><Link href={`/drivers/${id}/edit`}><Pencil /> Edit</Link></Button><ActiveToggle entity="driver" id={id} active={d.status === "ACTIVE"} label={d.name} /></>)}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Trips" value={trips} />
        <StatCard label="Waste Collected" value={formatTonnes(agg._sum.netWeight)} sub={`${agg._count} weighments`} tone="navy" />
        <StatCard label="Completion Rate" value={trips + missed ? `${Math.round((trips / (trips + missed)) * 100)}%` : "—"} sub={`${missed} not collected`} tone="slate" />
        <StatCard label="Avg per Trip" value={agg._count ? formatQty(Number(agg._sum.netWeight) / agg._count, "kg") : "—"} tone="slate" />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card>
          <CardContent>
            <DetailGrid
              cols={2}
              items={[
                { label: "Licence Number", value: <span className="font-mono">{d.licenceNumber}</span> },
                { label: "Licence Expiry", value: <ExpiryCell date={d.licenceExpiry} /> },
                { label: "Joining Date", value: formatDate(d.joiningDate) },
                { label: "Assigned Vehicle", value: d.defaultForVehicles.map((v) => v.number).join(", ") },
                { label: "Address", value: d.address },
                { label: "Remarks", value: d.remarks },
              ]}
            />
          </CardContent>
        </Card>
        <div className="xl:col-span-2">
          <DocumentsPanel entityType="driver" entityId={id} category="DRIVER_DOCUMENT" categories={["DRIVER_DOCUMENT", "OTHER"]} canUpload={manage || user.permissions.includes("documents.manage")} />
        </div>
        <Section title="Recent Collections" className="xl:col-span-3">
          <DataTable
            rows={recent}
            rowKey={(r) => r.id}
            empty="No collections yet"
            columns={[
              { key: "n", header: "Collection", cell: (r) => <span className="font-mono text-xs">{r.number}</span> },
              { key: "d", header: "Date", cell: (r) => formatDateTime(r.collectionDate) },
              { key: "c", header: "Customer / Site", cell: (r) => `${r.customer.name} · ${r.site.name}` },
              { key: "v", header: "Vehicle", cell: (r) => r.vehicle.number },
              { key: "w", header: "Waste", cell: (r) => r.wasteType.name },
              { key: "q", header: "Qty (KG)", align: "right", cell: (r) => formatQty(r.actualQty ?? r.estimatedQty) },
              { key: "s", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
            ]}
          />
        </Section>
      </div>
    </>
  );
}
