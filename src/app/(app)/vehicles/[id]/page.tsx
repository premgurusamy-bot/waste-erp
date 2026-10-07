import { Fuel, Pencil, Wrench } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fuelAction, maintenanceAction } from "@/app/actions/fleet";
import { FormDialog } from "@/components/forms/confirm-action";
import { EntityForm } from "@/components/forms/entity-form";
import { ActiveToggle } from "@/components/shared/active-toggle";
import { DocumentsPanel } from "@/components/shared/documents-panel";
import { ExpiryCell } from "@/components/shared/expiry";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { DetailGrid, FilterBar, FilterField, FText, PageHeader, Section, StatCard } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { opt, PAYMENT_MODE_OPTIONS } from "@/lib/fields";
import { str, type SP } from "@/lib/list-params";
import { formatDate, formatDateTime, formatMoney, formatQty, formatTonnes, todayISO } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { vehicleStats } from "@/server/services/fleet-stats";
import { cashBankOptions, driverOptions, supplierOptions } from "@/server/options";

export default async function VehiclePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const user = await requirePermission("vehicles.view");
  const { id } = await params;
  const sp = await searchParams;
  const v = await prisma.vehicle.findUnique({ where: { id }, include: { defaultDriver: true } });
  if (!v) notFound();
  const to = str(sp, "to") ?? todayISO();
  const from = str(sp, "from") ?? `${to.slice(0, 4)}-01-01`;
  const [[s], fuel, maint, trips, drivers, suppliers, accounts] = await Promise.all([
    vehicleStats(from, to, id),
    prisma.vehicleFuel.findMany({ where: { vehicleId: id }, include: { driver: true, expense: true }, orderBy: { date: "desc" }, take: 20 }),
    prisma.vehicleMaintenance.findMany({ where: { vehicleId: id }, include: { supplier: true, expense: true }, orderBy: { date: "desc" }, take: 20 }),
    prisma.weighment.findMany({ where: { vehicleId: id }, include: { customer: true, wasteType: true }, orderBy: { gateInAt: "desc" }, take: 15 }),
    driverOptions(),
    supplierOptions(),
    cashBankOptions(),
  ]);
  const manage = user.permissions.includes("vehicles.manage");
  const fin = user.permissions.includes("reports.financial") || user.permissions.includes("expenses.view");
  const payFields = [
    { name: "paymentMode", label: "Payment Mode", type: "select" as const, options: [...PAYMENT_MODE_OPTIONS, { value: "CREDIT", label: "Credit (pay later)" }] },
    { name: "accountId", label: "Paid From", type: "select" as const, options: accounts, help: "Not needed for credit" },
  ];
  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2">{v.number} <StatusBadge status={v.status} /></span>}
        description={`${v.type} · ${formatQty(v.capacityKg, "kg")} capacity · ${v.fuelType}`}
        crumbs={[{ href: "/vehicles", label: "Vehicles" }]}
        actions={
          manage && (
            <>
              <FormDialog label="Fuel Entry" icon={<Fuel />} title={`Fuel entry · ${v.number}`} variant="default">
                <EntityForm
                  schemaKey="fuel"
                  cols={2}
                  fields={[
                    { name: "date", label: "Date", type: "date", required: true },
                    { name: "driverId", label: "Driver", type: "select", options: drivers },
                    { name: "litres", label: "Litres", type: "number", required: true },
                    { name: "ratePerLitre", label: "Rate / Litre", type: "number", required: true },
                    { name: "odometer", label: "Odometer (km)", type: "number", step: "1" },
                    { name: "fuelStation", label: "Fuel Station" },
                    ...payFields,
                    { name: "supplierId", label: "Supplier (for credit)", type: "select", options: suppliers },
                  ]}
                  defaultValues={{ vehicleId: id, date: todayISO(), paymentMode: "CASH", driverId: v.defaultDriverId ?? "" }}
                  action={async (vals) => { "use server"; return fuelAction({ ...vals, vehicleId: id }); }}
                  successMessage="Fuel entry saved and expense posted"
                />
              </FormDialog>
              <FormDialog label="Maintenance" icon={<Wrench />} title={`Maintenance · ${v.number}`}>
                <EntityForm
                  schemaKey="maintenance"
                  cols={2}
                  fields={[
                    { name: "date", label: "Date", type: "date", required: true },
                    { name: "maintenanceType", label: "Type", type: "select", options: opt(["SERVICE", "REPAIR", "TYRE", "BATTERY", "BODY_WORK", "OTHER"]), required: true },
                    { name: "description", label: "Work Done", required: true, span: 2 },
                    { name: "amount", label: "Amount", type: "number", required: true },
                    { name: "supplierId", label: "Vendor / Garage", type: "select", options: suppliers },
                    { name: "odometer", label: "Odometer (km)", type: "number", step: "1" },
                    { name: "nextServiceDate", label: "Next Service Due", type: "date" },
                    ...payFields,
                  ]}
                  defaultValues={{ vehicleId: id, date: todayISO(), paymentMode: "CASH", maintenanceType: "SERVICE" }}
                  action={async (vals) => { "use server"; return maintenanceAction({ ...vals, vehicleId: id }); }}
                  successMessage="Maintenance saved and expense posted"
                />
              </FormDialog>
              <Button variant="outline" size="sm" asChild><Link href={`/vehicles/${id}/edit`}><Pencil /> Edit</Link></Button>
              <ActiveToggle entity="vehicle" id={id} active={v.status !== "INACTIVE"} label={v.number} />
            </>
          )
        }
      />
      <Card className="mb-4">
        <FilterBar>
          <FilterField label="From"><FText type="date" name="from" defaultValue={from} /></FilterField>
          <FilterField label="To"><FText type="date" name="to" defaultValue={to} /></FilterField>
        </FilterBar>
        <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-6">
          <StatCard label="Trips" value={s.trips} sub={`${s.weighments} weighments`} />
          <StatCard label="Waste Collected" value={formatTonnes(s.kg)} />
          <StatCard label="Fuel" value={`${formatQty(s.fuelLitres)} L`} sub={fin ? formatMoney(s.fuel) : undefined} tone="amber" />
          {fin && <StatCard label="Maintenance" value={formatMoney(s.maintenance)} tone="slate" />}
          {fin && <StatCard label="Revenue" value={formatMoney(s.revenue)} tone="navy" />}
          {fin && <StatCard label="Profitability" value={formatMoney(s.profit)} tone={s.profit >= 0 ? "green" : "red"} sub={`Expenses ${formatMoney(s.expenses)}`} />}
        </div>
      </Card>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Section title="Document Status" className="xl:col-span-1">
          <CardContent>
            <DetailGrid
              cols={2}
              items={[
                { label: `RC ${v.rcNumber ?? ""}`, value: <ExpiryCell date={v.rcExpiry} /> },
                { label: "Insurance", value: <ExpiryCell date={v.insuranceExpiry} /> },
                { label: "Fitness (FC)", value: <ExpiryCell date={v.fcExpiry} /> },
                { label: "Pollution (PUC)", value: <ExpiryCell date={v.pollutionExpiry} /> },
                { label: "Permit", value: <ExpiryCell date={v.permitExpiry} /> },
                { label: "Default Driver", value: v.defaultDriver ? <Link className="text-navy-700 hover:underline" href={`/drivers/${v.defaultDriverId}`}>{v.defaultDriver.name}</Link> : null },
                { label: "Ownership", value: `${v.ownership}${v.ownerName ? ` (${v.ownerName})` : ""}` },
                { label: "Standard Tare", value: v.standardTareKg ? formatQty(v.standardTareKg, "kg") : null },
              ]}
            />
          </CardContent>
        </Section>
        <div className="xl:col-span-2">
          <DocumentsPanel entityType="vehicle" entityId={id} category="VEHICLE_DOCUMENT" categories={["VEHICLE_DOCUMENT", "OTHER"]} canUpload={manage || user.permissions.includes("documents.manage")} title="Vehicle Documents (RC, insurance, FC, PUC, permit)" />
        </div>
        <Section title="Fuel Log" className="xl:col-span-3">
          <DataTable
            rows={fuel}
            rowKey={(f) => f.id}
            empty="No fuel entries"
            columns={[
              { key: "d", header: "Date", cell: (f) => formatDate(f.date) },
              { key: "dr", header: "Driver", cell: (f) => f.driver?.name },
              { key: "l", header: "Litres", align: "right", cell: (f) => formatQty(f.litres) },
              { key: "r", header: "Rate", align: "right", cell: (f) => formatMoney(f.ratePerLitre) },
              { key: "a", header: "Amount", align: "right", cell: (f) => formatMoney(f.amount) },
              { key: "o", header: "Odometer", align: "right", cell: (f) => f.odometer },
              { key: "e", header: "Expense", cell: (f) => <Link className="text-navy-700 hover:underline" href={`/expenses/${f.expenseId}`}>{f.expense.number}</Link> },
              { key: "s", header: "Status", cell: (f) => <StatusBadge status={f.expense.status} /> },
            ]}
          />
        </Section>
        <Section title="Maintenance History" className="xl:col-span-3">
          <DataTable
            rows={maint}
            rowKey={(m) => m.id}
            empty="No maintenance recorded"
            columns={[
              { key: "d", header: "Date", cell: (m) => formatDate(m.date) },
              { key: "t", header: "Type", cell: (m) => m.maintenanceType },
              { key: "ds", header: "Work Done", cell: (m) => m.description },
              { key: "v", header: "Vendor", cell: (m) => m.supplier?.name },
              { key: "a", header: "Amount", align: "right", cell: (m) => formatMoney(m.amount) },
              { key: "n", header: "Next Service", cell: (m) => formatDate(m.nextServiceDate) },
              { key: "s", header: "Status", cell: (m) => <StatusBadge status={m.expense.status} /> },
            ]}
          />
        </Section>
        <Section title="Recent Trips (weighments)" className="xl:col-span-3">
          <DataTable
            rows={trips}
            rowKey={(w) => w.id}
            empty="No trips"
            columns={[
              { key: "n", header: "Weighment", cell: (w) => <Link className="text-navy-700 hover:underline" href={`/weighments/${w.id}`}>{w.number}</Link> },
              { key: "d", header: "Date", cell: (w) => formatDateTime(w.gateInAt) },
              { key: "c", header: "Customer", cell: (w) => w.customer.name },
              { key: "w", header: "Waste", cell: (w) => w.wasteType.name },
              { key: "net", header: "Net (KG)", align: "right", cell: (w) => formatQty(w.netWeight) },
              { key: "s", header: "Status", cell: (w) => <StatusBadge status={w.status} /> },
            ]}
          />
        </Section>
      </div>
    </>
  );
}
