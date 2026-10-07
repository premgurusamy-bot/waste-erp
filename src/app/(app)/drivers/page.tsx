import { Plus } from "lucide-react";
import Link from "next/link";
import { ExpiryCell } from "@/components/shared/expiry";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { FilterBar, FilterField, FText, PageHeader } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { ci, str, type SP } from "@/lib/list-params";
import { formatQty, localDayRange, num, todayISO } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";

export const metadata = { title: "Drivers" };

export default async function DriversPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("drivers.view");
  const sp = await searchParams;
  const q = str(sp, "q");
  const to = str(sp, "to") ?? todayISO();
  const from = str(sp, "from") ?? `${to.slice(0, 7)}-01`;
  const range = localDayRange(from, to);
  const drivers = await prisma.driver.findMany({
    where: q ? { OR: [{ name: ci(q) }, { code: ci(q) }, { licenceNumber: ci(q) }, { mobile: ci(q) }] } : {},
    include: { defaultForVehicles: true },
    orderBy: { name: "asc" },
  });
  const [trips, kg, missed] = await Promise.all([
    prisma.collectionEntry.groupBy({ by: ["driverId"], where: { collectionDate: range, status: { not: "NOT_COLLECTED" } }, _count: true }),
    prisma.weighment.groupBy({ by: ["driverId"], where: { gateInAt: range, status: "COMPLETED" }, _sum: { netWeight: true } }),
    prisma.collectionEntry.groupBy({ by: ["driverId"], where: { collectionDate: range, status: "NOT_COLLECTED" }, _count: true }),
  ]);
  return (
    <>
      <PageHeader title="Drivers" description="Licence status, trips and collection performance" actions={user.permissions.includes("drivers.manage") && <Button asChild><Link href="/drivers/new"><Plus /> New Driver</Link></Button>} />
      <Card>
        <FilterBar reset="/drivers">
          <FilterField label="Search" className="min-w-56 flex-1"><FText name="q" defaultValue={q} placeholder="Name, code, licence, mobile" /></FilterField>
          <FilterField label="From"><FText type="date" name="from" defaultValue={from} /></FilterField>
          <FilterField label="To"><FText type="date" name="to" defaultValue={to} /></FilterField>
        </FilterBar>
        <DataTable
          rows={drivers}
          rowKey={(r) => r.id}
          empty="No drivers yet"
          columns={[
            { key: "code", header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
            { key: "name", header: "Driver", cell: (r) => <Link href={`/drivers/${r.id}`} className="font-medium text-navy-700 hover:underline">{r.name}</Link> },
            { key: "mob", header: "Mobile", cell: (r) => r.mobile },
            { key: "veh", header: "Vehicle", cell: (r) => r.defaultForVehicles.map((v) => v.number).join(", ") },
            { key: "trips", header: "Trips", align: "right", cell: (r) => trips.find((t) => t.driverId === r.id)?._count ?? 0 },
            { key: "kg", header: "Collected (KG)", align: "right", cell: (r) => formatQty(num(kg.find((t) => t.driverId === r.id)?._sum.netWeight)) },
            { key: "perf", header: "Performance", cell: (r) => { const t = trips.find((x) => x.driverId === r.id)?._count ?? 0; const m = missed.find((x) => x.driverId === r.id)?._count ?? 0; return t + m ? `${Math.round((t / (t + m)) * 100)}% completion` : "—"; } },
            { key: "lic", header: "Licence", cell: (r) => <div><div className="font-mono text-xs">{r.licenceNumber}</div><ExpiryCell date={r.licenceExpiry} /></div> },
            { key: "st", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
      </Card>
    </>
  );
}
