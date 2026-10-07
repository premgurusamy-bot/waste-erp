import { Plus } from "lucide-react";
import Link from "next/link";
import { worstExpiry } from "@/components/shared/expiry";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { FilterBar, FilterField, FText, PageHeader, StatCard } from "@/components/ui/page";
import { str, type SP } from "@/lib/list-params";
import { formatMoney, formatQty, formatTonnes, todayISO } from "@/lib/utils";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { vehicleStats } from "@/server/services/fleet-stats";

export const metadata = { title: "Vehicles" };

export default async function VehiclesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("vehicles.view");
  const sp = await searchParams;
  const to = str(sp, "to") ?? todayISO();
  const from = str(sp, "from") ?? `${to.slice(0, 7)}-01`;
  const [stats, vehicles] = await Promise.all([vehicleStats(from, to), prisma.vehicle.findMany()]);
  const vmap = new Map(vehicles.map((v) => [v.id, v]));
  const docState = (id: string) => {
    const v = vmap.get(id)!;
    return worstExpiry([v.rcExpiry, v.insuranceExpiry, v.fcExpiry, v.pollutionExpiry, v.permitExpiry]);
  };
  const fin = user.permissions.includes("reports.financial") || user.permissions.includes("expenses.view");
  const alerts = stats.filter((s) => docState(s.id) !== "ACTIVE").length;
  return (
    <>
      <PageHeader title="Vehicles" description="Fleet performance, documents and running costs" actions={user.permissions.includes("vehicles.manage") && <Button asChild><Link href="/vehicles/new"><Plus /> New Vehicle</Link></Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Vehicles" value={stats.length} sub={`${stats.filter((s) => s.status === "ACTIVE").length} active`} tone="navy" />
        <StatCard label="Trips" value={stats.reduce((s, v) => s + v.trips, 0)} />
        <StatCard label="Waste Moved" value={formatTonnes(stats.reduce((s, v) => s + v.kg, 0))} />
        {fin && <StatCard label="Fuel Cost" value={formatMoney(stats.reduce((s, v) => s + v.fuel, 0))} tone="amber" />}
        <StatCard label="Document Alerts" value={alerts} tone={alerts ? "red" : "green"} sub="Expired or expiring in 30 days" />
      </div>
      <Card>
        <FilterBar reset="/vehicles">
          <FilterField label="From"><FText type="date" name="from" defaultValue={from} /></FilterField>
          <FilterField label="To"><FText type="date" name="to" defaultValue={to} /></FilterField>
        </FilterBar>
        <DataTable
          rows={stats}
          rowKey={(r) => r.id}
          empty="No vehicles yet"
          columns={[
            { key: "no", header: "Vehicle", cell: (r) => <Link href={`/vehicles/${r.id}`} className="font-medium text-navy-700 hover:underline">{r.number}</Link> },
            { key: "type", header: "Type", cell: (r) => r.type },
            { key: "drv", header: "Driver", hideOnMobile: true, cell: (r) => r.driver },
            { key: "cap", header: "Capacity", align: "right", hideOnMobile: true, cell: (r) => formatQty(r.capacityKg, "kg") },
            { key: "trips", header: "Trips", align: "right", cell: (r) => r.trips },
            { key: "kg", header: "Waste (KG)", align: "right", cell: (r) => formatQty(r.kg) },
            ...(fin
              ? [
                  { key: "fuel", header: "Fuel", align: "right" as const, cell: (r: (typeof stats)[number]) => `${formatQty(r.fuelLitres)} L · ${formatMoney(r.fuel)}` },
                  { key: "maint", header: "Maintenance", align: "right" as const, cell: (r: (typeof stats)[number]) => formatMoney(r.maintenance) },
                  { key: "exp", header: "Expenses", align: "right" as const, cell: (r: (typeof stats)[number]) => formatMoney(r.expenses) },
                  { key: "rev", header: "Revenue", align: "right" as const, cell: (r: (typeof stats)[number]) => formatMoney(r.revenue) },
                  { key: "profit", header: "Profitability", align: "right" as const, cell: (r: (typeof stats)[number]) => <span className={r.profit >= 0 ? "text-brand-700" : "text-red-600"}>{formatMoney(r.profit)}</span> },
                ]
              : []),
            { key: "docs", header: "Documents", cell: (r) => <StatusBadge status={docState(r.id)} label={docState(r.id) === "ACTIVE" ? "Active" : docState(r.id) === "EXPIRED" ? "Expired" : "Expiring soon"} /> },
            { key: "st", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
      </Card>
      {fin && <p className="mt-2 text-xs text-slate-500">Revenue is attributed from billed invoice lines (weight × rate per weighment, or rate per trip). Monthly fixed contracts are not attributed to vehicles.</p>}
    </>
  );
}
