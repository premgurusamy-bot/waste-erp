import { Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActiveToggle } from "@/components/shared/active-toggle";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { DetailGrid, PageHeader, Section, StatCard } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { formatDateTime, formatQty, formatTonnes, titleCase } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("customers.view");
  const { id } = await params;
  const s = await prisma.customerSite.findUnique({ where: { id }, include: { customer: true, defaultWasteType: true } });
  if (!s) notFound();
  const [agg, trips, weighments] = await Promise.all([
    prisma.weighment.aggregate({ where: { siteId: id, status: "COMPLETED" }, _sum: { netWeight: true }, _count: true }),
    prisma.collectionEntry.count({ where: { siteId: id, status: { not: "NOT_COLLECTED" } } }),
    prisma.weighment.findMany({ where: { siteId: id }, include: { vehicle: true, wasteType: true }, orderBy: { gateInAt: "desc" }, take: 25 }),
  ]);
  const manage = user.permissions.includes("customers.manage");
  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2">{s.name} <StatusBadge status={s.status} /></span>}
        description={`${s.code} · ${s.customer.name}`}
        crumbs={[{ href: "/sites", label: "Sites" }]}
        actions={manage && (<><Button variant="outline" size="sm" asChild><Link href={`/sites/${id}/edit`}><Pencil /> Edit</Link></Button><ActiveToggle entity="site" id={id} active={s.status === "ACTIVE"} label={s.name} /></>)}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total Collected" value={formatTonnes(agg._sum.netWeight)} />
        <StatCard label="Weighments" value={agg._count} tone="navy" />
        <StatCard label="Collection Trips" value={trips} tone="slate" />
        <StatCard label="Frequency" value={titleCase(s.frequency)} sub={s.collectionTime ? `Around ${s.collectionTime}` : undefined} tone="slate" />
      </div>
      <Card className="mb-4">
        <CardContent>
          <DetailGrid
            items={[
              { label: "Customer", value: <Link className="text-navy-700 hover:underline" href={`/customers/${s.customerId}`}>{s.customer.name}</Link> },
              { label: "Waste Type", value: s.defaultWasteType?.name },
              { label: "Address", value: s.address },
              { label: "Site Contact", value: [s.contactName, s.contactMobile].filter(Boolean).join(" · ") },
              { label: "GPS", value: s.latitude ? <a target="_blank" className="text-brand-700 hover:underline" href={`https://maps.google.com/?q=${s.latitude},${s.longitude}`}>{`${s.latitude}, ${s.longitude}`}</a> : null },
              { label: "Remarks", value: s.remarks },
            ]}
          />
        </CardContent>
      </Card>
      <Section title="Recent Weighments">
        <DataTable
          rows={weighments}
          rowKey={(w) => w.id}
          empty="No weighments for this site"
          columns={[
            { key: "n", header: "Weighment", cell: (w) => <Link href={`/weighments/${w.id}`} className="text-navy-700 hover:underline">{w.number}</Link> },
            { key: "d", header: "Gate In", cell: (w) => formatDateTime(w.gateInAt) },
            { key: "v", header: "Vehicle", cell: (w) => w.vehicle.number },
            { key: "w", header: "Waste", cell: (w) => w.wasteType.name },
            { key: "net", header: "Net (KG)", align: "right", cell: (w) => formatQty(w.netWeight) },
            { key: "s", header: "Status", cell: (w) => <StatusBadge status={w.status} /> },
          ]}
        />
      </Section>
    </>
  );
}
