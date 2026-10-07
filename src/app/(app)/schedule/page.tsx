import { CalendarClock, ChevronLeft, ChevronRight, ClipboardCheck, List, Plus, Truck, XCircle } from "lucide-react";
import Link from "next/link";
import { assignScheduleAction, cancelScheduleAction, createScheduleAction, rescheduleAction } from "@/app/actions/operations";
import { ConfirmAction, FormDialog } from "@/components/forms/confirm-action";
import { EntityForm } from "@/components/forms/entity-form";
import { GenerateSchedulesButton, StartButton } from "@/components/shared/generate-button";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader, StatCard } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { str, type SP } from "@/lib/list-params";
import { scheduleFields } from "@/lib/ops-fields";
import { addDays, cn, dateOnly, formatDate, todayISO, toISODate } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { customerOptions, driverOptions, siteOptions, vehicleOptions, wasteTypeOptions } from "@/server/options";

export const metadata = { title: "Collection Schedule" };

export default async function SchedulePage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("pickups.view");
  const sp = await searchParams;
  const date = str(sp, "date") ?? todayISO();
  const view = str(sp, "view") ?? "list";
  const vehicleFilter = str(sp, "vehicleId");
  const d = dateOnly(date);
  const manage = user.permissions.includes("pickups.manage");
  const canCollect = user.permissions.includes("collections.manage");
  const [customers, sites, wasteTypes, vehicles, drivers] = await Promise.all([customerOptions(), siteOptions(), wasteTypeOptions(), vehicleOptions(), driverOptions()]);
  const include = { customer: true, site: true, wasteType: true, vehicle: true, driver: true, pickupRequest: true } as const;

  if (view === "week") {
    const dow = (d.getUTCDay() + 6) % 7;
    const monday = addDays(d, -dow);
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const rows = await prisma.collectionSchedule.findMany({
      where: { scheduledDate: { gte: monday, lte: days[6] }, ...(vehicleFilter ? { vehicleId: vehicleFilter } : {}) },
      include,
      orderBy: [{ scheduledTime: "asc" }],
    });
    return (
      <>
        <PageHeader
          title="Collection Schedule"
          description={`Week of ${formatDate(monday)}`}
          actions={<ViewSwitch date={date} view={view} />}
        />
        <div className="mb-3 flex items-center gap-2">
          <Button variant="outline" size="sm" asChild><Link href={`/schedule?view=week&date=${toISODate(addDays(monday, -7))}`}><ChevronLeft /> Prev week</Link></Button>
          <Button variant="outline" size="sm" asChild><Link href={`/schedule?view=week&date=${todayISO()}`}>This week</Link></Button>
          <Button variant="outline" size="sm" asChild><Link href={`/schedule?view=week&date=${toISODate(addDays(monday, 7))}`}>Next week <ChevronRight /></Link></Button>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
          {days.map((day) => {
            const iso = toISODate(day);
            const items = rows.filter((r) => toISODate(r.scheduledDate) === iso);
            return (
              <Card key={iso} className={cn("min-h-40 p-2", iso === todayISO() && "ring-2 ring-brand-500")}>
                <Link href={`/schedule?date=${iso}`} className="mb-2 block text-xs font-semibold text-navy-700 hover:underline">
                  {day.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" })} · {items.length}
                </Link>
                <div className="space-y-1.5">
                  {items.map((r) => (
                    <div key={r.id} className={cn("rounded-md border px-2 py-1 text-[11px] leading-tight", r.status === "COMPLETED" ? "border-brand-200 bg-brand-50" : r.status === "CANCELLED" ? "border-red-100 bg-red-50 line-through opacity-60" : "border-slate-200 bg-white")}>
                      <p className="font-medium">{r.scheduledTime} {r.customer.name}</p>
                      <p className="text-slate-500">{r.wasteType.name} · {r.vehicle?.number ?? "Unassigned"}</p>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      </>
    );
  }

  const [rows, pending] = await Promise.all([
    prisma.collectionSchedule.findMany({ where: { scheduledDate: d, ...(vehicleFilter ? { vehicleId: vehicleFilter } : {}) }, include, orderBy: [{ scheduledTime: "asc" }, { createdAt: "asc" }] }),
    prisma.pickupRequest.count({ where: { status: "PENDING" } }),
  ]);
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  return (
    <>
      <PageHeader
        title="Collection Schedule"
        description={`Daily operations board · ${formatDate(d)}`}
        actions={
          <>
            <ViewSwitch date={date} view={view} />
            {manage && <GenerateSchedulesButton date={date} />}
            {manage && (
              <FormDialog label="New Schedule" icon={<Plus />} title="New collection schedule" variant="default" size="md" wide>
                <EntityForm schemaKey="schedule" cols={2} fields={scheduleFields(customers, sites, wasteTypes, vehicles, drivers)} defaultValues={{ scheduledDate: date }} action={createScheduleAction} successMessage="Schedule created" />
              </FormDialog>
            )}
          </>
        }
      />
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2 no-print">
        <Button variant="outline" size="sm" asChild><Link href={`/schedule?date=${toISODate(addDays(d, -1))}`} aria-label="Previous day"><ChevronLeft /></Link></Button>
        <input type="date" name="date" defaultValue={date} className="h-8 rounded-lg border border-slate-300 px-2 text-sm" aria-label="Date" />
        <select name="vehicleId" defaultValue={vehicleFilter} className="h-8 rounded-lg border border-slate-300 px-2 text-sm" aria-label="Vehicle">
          <option value="">All vehicles</option>
          {vehicles.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
        </select>
        <Button size="sm" variant="navy">Go</Button>
        <Button variant="outline" size="sm" asChild><Link href={`/schedule?date=${toISODate(addDays(d, 1))}`} aria-label="Next day"><ChevronRight /></Link></Button>
        <Button variant="ghost" size="sm" asChild><Link href="/schedule">Today</Link></Button>
        {pending > 0 && <Link href="/pickups?status=PENDING" className="ml-auto text-sm font-medium text-amber-700 hover:underline">{pending} pending pickup request(s) to schedule →</Link>}
      </form>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Scheduled" value={rows.filter((r) => r.status !== "CANCELLED").length} tone="navy" />
        <StatCard label="Unassigned" value={count("SCHEDULED")} tone={count("SCHEDULED") ? "amber" : "slate"} />
        <StatCard label="Assigned" value={count("ASSIGNED")} tone="slate" />
        <StatCard label="In Progress" value={count("IN_PROGRESS")} tone="navy" />
        <StatCard label="Completed" value={count("COMPLETED")} />
      </div>
      <Card>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          empty="Nothing scheduled for this day"
          emptyHint={manage ? "Use “Generate daily schedules” or schedule pending pickups." : undefined}
          columns={[
            { key: "t", header: "Time", cell: (r) => <span className="font-medium">{r.scheduledTime ?? "—"}</span> },
            { key: "c", header: "Customer / Site", cell: (r) => <div><div className="font-medium text-navy-700">{r.customer.name}</div><div className="text-xs text-slate-500">{r.site.name}{r.pickupRequest ? ` · ${r.pickupRequest.number}` : ""}</div></div> },
            { key: "w", header: "Waste Type", cell: (r) => r.wasteType.name },
            { key: "v", header: "Vehicle", cell: (r) => r.vehicle?.number ?? <span className="text-amber-600">Not assigned</span> },
            { key: "d", header: "Driver", cell: (r) => r.driver?.name ?? <span className="text-amber-600">Not assigned</span> },
            { key: "s", header: "Status", cell: (r) => <div className="flex flex-col items-start gap-0.5"><StatusBadge status={r.status} />{r.rescheduleCount > 0 && <span className="text-[10px] text-slate-400">Rescheduled ×{r.rescheduleCount}</span>}</div> },
            {
              key: "a",
              header: "Actions",
              cell: (r) => { const rid = r.id; return (
                <div className="flex flex-wrap justify-end gap-1">
                  {manage && ["SCHEDULED", "ASSIGNED"].includes(r.status) && (
                    <FormDialog label={r.status === "SCHEDULED" ? "Assign" : "Reassign"} icon={<Truck />} title={`Assign vehicle & driver · ${r.customer.name}`} variant={r.status === "SCHEDULED" ? "default" : "outline"}>
                      <EntityForm
                        schemaKey="assign"
                        cols={1}
                        fields={[
                          { name: "vehicleId", label: "Vehicle", type: "select", options: vehicles, required: true },
                          { name: "driverId", label: "Driver", type: "select", options: drivers, required: true },
                        ]}
                        defaultValues={{ scheduleId: r.id, vehicleId: r.vehicleId ?? "", driverId: r.driverId ?? "" }}
                        action={async (v) => { "use server"; return assignScheduleAction({ ...v, scheduleId: rid }); }}
                        successMessage="Vehicle and driver assigned"
                      />
                    </FormDialog>
                  )}
                  {(manage || canCollect) && r.status === "ASSIGNED" && <StartButton id={r.id} />}
                  {canCollect && ["ASSIGNED", "IN_PROGRESS"].includes(r.status) && (
                    <Button size="sm" asChild><Link href={`/collections/new?scheduleId=${r.id}`}><ClipboardCheck /> Complete</Link></Button>
                  )}
                  {manage && ["SCHEDULED", "ASSIGNED"].includes(r.status) && (
                    <FormDialog label="Reschedule" icon={<CalendarClock />} title="Reschedule collection">
                      <EntityForm
                        schemaKey="reschedule"
                        cols={2}
                        fields={[
                          { name: "scheduledDate", label: "New Date", type: "date", required: true },
                          { name: "scheduledTime", label: "New Time", type: "time" },
                          { name: "remarks", label: "Reason / Remarks", type: "textarea" },
                        ]}
                        defaultValues={{ scheduleId: r.id, scheduledDate: date, scheduledTime: r.scheduledTime ?? "" }}
                        action={async (v) => { "use server"; return rescheduleAction({ ...v, scheduleId: rid }); }}
                        successMessage="Rescheduled"
                      />
                    </FormDialog>
                  )}
                  {manage && !["COMPLETED", "CANCELLED"].includes(r.status) && (
                    <ConfirmAction label="" icon={<XCircle />} variant="ghost" title="Cancel this collection?" requireReason action={cancelScheduleAction.bind(null, r.id)} successMessage="Schedule cancelled" />
                  )}
                </div>
              ); },
            },
          ]}
        />
      </Card>
    </>
  );
}

function ViewSwitch({ date, view }: { date: string; view: string }) {
  return (
    <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
      <Link href={`/schedule?date=${date}`} className={cn("flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium", view === "list" ? "bg-navy-700 text-white" : "text-slate-600")}><List className="size-3.5" /> Day list</Link>
      <Link href={`/schedule?view=week&date=${date}`} className={cn("flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium", view === "week" ? "bg-navy-700 text-white" : "text-slate-600")}><CalendarClock className="size-3.5" /> Week calendar</Link>
    </div>
  );
}
