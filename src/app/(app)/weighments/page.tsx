import { LogIn } from "lucide-react";
import Link from "next/link";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { FilterBar, FilterField, FSelect, FText, PageHeader, StatCard } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { opt } from "@/lib/fields";
import { ci, flat, listParams, str, type SP } from "@/lib/list-params";
import { formatDateTime, formatQty, formatTonnes, localDayRange, todayISO } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { customerOptions, vehicleOptions, wasteTypeOptions } from "@/server/options";

export const metadata = { title: "Weighment" };

export default async function WeighmentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("weighments.view");
  const sp = await searchParams;
  const { page, pageSize, skip, take, q, status } = listParams(sp);
  const to = str(sp, "to") ?? todayISO();
  const from = str(sp, "from") ?? to;
  const customerId = str(sp, "customerId");
  const vehicleId = str(sp, "vehicleId");
  const wasteTypeId = str(sp, "wasteTypeId");
  const where = {
    gateInAt: localDayRange(from, to),
    ...(q ? { OR: [{ number: ci(q) }, { slipNumber: ci(q) }, { vehicle: { number: ci(q) } }, { customer: { name: ci(q) } }] } : {}),
    ...(status ? { status: status as any } : {}),
    ...(customerId ? { customerId } : {}),
    ...(vehicleId ? { vehicleId } : {}),
    ...(wasteTypeId ? { wasteTypeId } : {}),
  };
  const [rows, total, agg, open, customers, vehicles, wasteTypes] = await Promise.all([
    prisma.weighment.findMany({ where, include: { vehicle: true, customer: true, site: true, wasteType: true }, orderBy: { gateInAt: "desc" }, skip, take }),
    prisma.weighment.count({ where }),
    prisma.weighment.aggregate({ where: { ...where, status: "COMPLETED" }, _sum: { netWeight: true, grossWeight: true }, _count: true }),
    prisma.weighment.findMany({ where: { status: "GATE_IN" }, include: { vehicle: true, customer: true }, orderBy: { gateInAt: "asc" } }),
    customerOptions(true), vehicleOptions(true), wasteTypeOptions(),
  ]);
  const manage = user.permissions.includes("weighments.manage");
  return (
    <>
      <PageHeader title="Weighbridge" description="Gate-in gross weight, gate-out tare weight, net weight calculated automatically" actions={manage && <Button asChild><Link href="/weighments/new"><LogIn /> Gate In</Link></Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Completed" value={agg._count} sub="in selected period" tone="navy" />
        <StatCard label="Net Weight Received" value={formatTonnes(agg._sum.netWeight)} sub={`${formatQty(agg._sum.netWeight)} kg`} />
        <StatCard label="Vehicles Inside (gate-in)" value={open.length} tone={open.length ? "amber" : "slate"} />
        <StatCard label="Avg Net / Weighment" value={agg._count ? `${formatQty(Number(agg._sum.netWeight) / agg._count)} kg` : "—"} tone="slate" />
      </div>
      {open.length > 0 && (
        <Card className="mb-4 border-amber-200">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            <span className="text-sm font-medium text-amber-800">Awaiting gate-out:</span>
            {open.map((w) => (
              <Link key={w.id} href={`/weighments/${w.id}`} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100">
                {w.vehicle.number} · {w.customer.name} · {formatQty(w.grossWeight)} kg gross
              </Link>
            ))}
          </div>
        </Card>
      )}
      <Card>
        <FilterBar reset="/weighments">
          <FilterField label="Search" className="min-w-44 flex-1"><FText name="q" defaultValue={q} placeholder="WT no., slip, vehicle, customer" /></FilterField>
          <FilterField label="Customer"><FSelect name="customerId" defaultValue={customerId} options={customers} /></FilterField>
          <FilterField label="Vehicle"><FSelect name="vehicleId" defaultValue={vehicleId} options={vehicles} /></FilterField>
          <FilterField label="Waste Type"><FSelect name="wasteTypeId" defaultValue={wasteTypeId} options={wasteTypes} /></FilterField>
          <FilterField label="Status"><FSelect name="status" defaultValue={status} options={opt(["GATE_IN", "COMPLETED", "CANCELLED"])} /></FilterField>
          <FilterField label="From"><FText type="date" name="from" defaultValue={from} /></FilterField>
          <FilterField label="To"><FText type="date" name="to" defaultValue={to} /></FilterField>
        </FilterBar>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          empty="No weighments in this period"
          columns={[
            { key: "n", header: "Weighment ID", cell: (r) => <Link href={`/weighments/${r.id}`} className="font-medium text-navy-700 hover:underline">{r.number}</Link> },
            { key: "in", header: "Gate In", cell: (r) => formatDateTime(r.gateInAt) },
            { key: "v", header: "Vehicle", cell: (r) => <span className="font-medium">{r.vehicle.number}</span> },
            { key: "c", header: "Customer / Site", cell: (r) => <div><div>{r.customer.name}</div><div className="text-xs text-slate-500">{r.site?.name}</div></div> },
            { key: "w", header: "Waste Type", cell: (r) => r.wasteType.name },
            { key: "slip", header: "Slip", hideOnMobile: true, cell: (r) => <span className="font-mono text-xs">{r.slipNumber}</span> },
            { key: "g", header: "Gross", align: "right", cell: (r) => formatQty(r.grossWeight) },
            { key: "t", header: "Tare", align: "right", cell: (r) => formatQty(r.tareWeight) },
            { key: "net", header: "Net (KG)", align: "right", cell: (r) => <span className="font-semibold">{formatQty(r.netWeight)}{r.isNetOverridden && <Badge tone="amber" className="ml-1">Override</Badge>}</span> },
            { key: "s", header: "Status", cell: (r) => <StatusBadge status={r.status} label={r.status === "GATE_IN" ? "Gate In" : undefined} /> },
          ]}
        />
        <Pagination page={page} pageSize={pageSize} total={total} params={flat(sp)} />
      </Card>
    </>
  );
}
