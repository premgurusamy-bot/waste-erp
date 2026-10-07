import { CalendarPlus, Pencil, Plus, XCircle } from "lucide-react";
import Link from "next/link";
import { cancelPickupAction, createScheduleAction } from "@/app/actions/operations";
import { ConfirmAction, FormDialog } from "@/components/forms/confirm-action";
import { EntityForm } from "@/components/forms/entity-form";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { FilterBar, FilterField, FSelect, FText, PageHeader } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { opt } from "@/lib/fields";
import { ci, flat, listParams, str, type SP } from "@/lib/list-params";
import { scheduleFields } from "@/lib/ops-fields";
import { dateOnly, formatDate, formatQty } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { customerOptions, driverOptions, siteOptions, vehicleOptions, wasteTypeOptions } from "@/server/options";

export const metadata = { title: "Pickup Requests" };

export default async function PickupsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("pickups.view");
  const sp = await searchParams;
  const { page, pageSize, skip, take, q, status } = listParams(sp);
  const from = str(sp, "from");
  const to = str(sp, "to");
  const where = {
    ...(q ? { OR: [{ number: ci(q) }, { customer: { name: ci(q) } }, { site: { name: ci(q) } }] } : {}),
    ...(status ? { status: status as any } : {}),
    ...(from || to ? { requestedDate: { ...(from ? { gte: dateOnly(from) } : {}), ...(to ? { lte: dateOnly(to) } : {}) } } : {}),
  };
  const [rows, total, customers, sites, wasteTypes, vehicles, drivers] = await Promise.all([
    prisma.pickupRequest.findMany({ where, include: { customer: true, site: true, wasteType: true, schedules: { where: { status: { not: "CANCELLED" } }, include: { vehicle: true, driver: true } } }, orderBy: [{ requestedDate: "desc" }, { createdAt: "desc" }], skip, take }),
    prisma.pickupRequest.count({ where }),
    customerOptions(), siteOptions(), wasteTypeOptions(), vehicleOptions(), driverOptions(),
  ]);
  const manage = user.permissions.includes("pickups.manage");
  return (
    <>
      <PageHeader title="Pickup Requests" description="Customer requests waiting to be scheduled and collected" actions={manage && <Button asChild><Link href="/pickups/new"><Plus /> New Pickup</Link></Button>} />
      <Card>
        <FilterBar reset="/pickups">
          <FilterField label="Search" className="min-w-56 flex-1"><FText name="q" defaultValue={q} placeholder="Pickup ID, customer, site" /></FilterField>
          <FilterField label="Status"><FSelect name="status" defaultValue={status} options={opt(["PENDING", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"])} /></FilterField>
          <FilterField label="From"><FText type="date" name="from" defaultValue={from} /></FilterField>
          <FilterField label="To"><FText type="date" name="to" defaultValue={to} /></FilterField>
        </FilterBar>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          empty="No pickup requests"
          columns={[
            { key: "n", header: "Pickup ID", cell: (r) => <span className="font-mono text-xs font-medium">{r.number}</span> },
            { key: "c", header: "Customer / Site", cell: (r) => <div><Link href={`/customers/${r.customerId}`} className="font-medium text-navy-700 hover:underline">{r.customer.name}</Link><div className="text-xs text-slate-500">{r.site.name}</div></div> },
            { key: "w", header: "Waste Type", cell: (r) => r.wasteType.name },
            { key: "d", header: "Requested", cell: (r) => `${formatDate(r.requestedDate)} ${r.requestedTime ?? ""}` },
            { key: "q", header: "Est. Qty", align: "right", hideOnMobile: true, cell: (r) => (r.estimatedQty ? formatQty(r.estimatedQty, "kg") : "") },
            { key: "p", header: "Priority", cell: (r) => <StatusBadge status={r.priority} /> },
            { key: "a", header: "Assigned", hideOnMobile: true, cell: (r) => r.schedules[0] ? `${formatDate(r.schedules[0].scheduledDate)} · ${r.schedules[0].vehicle?.number ?? "no vehicle"}` : "" },
            { key: "s", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
            {
              key: "x",
              header: "",
              cell: (r) => { const rid = r.id; return (
                manage && (
                  <div className="flex justify-end gap-1">
                    {r.status === "PENDING" && r.schedules.length === 0 && (
                      <FormDialog label="Schedule" icon={<CalendarPlus />} title={`Schedule ${r.number}`} variant="default" wide>
                        <EntityForm
                          schemaKey="schedule"
                          cols={2}
                          fields={scheduleFields(customers, sites, wasteTypes, vehicles, drivers).map((f) => (["customerId", "siteId"].includes(f.name) ? { ...f, readOnly: true } : f))}
                          defaultValues={{ pickupRequestId: r.id, customerId: r.customerId, siteId: r.siteId, wasteTypeId: r.wasteTypeId, scheduledDate: r.requestedDate.toISOString().slice(0, 10), scheduledTime: r.requestedTime ?? "" }}
                          action={async (v) => { "use server"; return createScheduleAction({ ...v, pickupRequestId: rid }); }}
                          successMessage="Pickup scheduled"
                        />
                      </FormDialog>
                    )}
                    {r.status === "PENDING" && <Button variant="ghost" size="sm" asChild><Link href={`/pickups/${r.id}/edit`} aria-label="Edit"><Pencil /></Link></Button>}
                    {!["COMPLETED", "CANCELLED"].includes(r.status) && (
                      <ConfirmAction label="" icon={<XCircle />} variant="ghost" title={`Cancel ${r.number}?`} requireReason action={cancelPickupAction.bind(null, r.id)} successMessage="Pickup cancelled" />
                    )}
                  </div>
                )); },
            },
          ]}
        />
        <Pagination page={page} pageSize={pageSize} total={total} params={flat(sp)} />
      </Card>
    </>
  );
}
