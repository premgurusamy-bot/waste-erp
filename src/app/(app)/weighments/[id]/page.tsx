import { Pencil, Printer, XCircle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cancelWeighmentAction, overrideNetAction } from "@/app/actions/weighments";
import { ConfirmAction, FormDialog } from "@/components/forms/confirm-action";
import { EntityForm } from "@/components/forms/entity-form";
import { GateOutForm } from "@/components/forms/gate-out-form";
import { DocumentsPanel } from "@/components/shared/documents-panel";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DetailGrid, PageHeader, Section } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { formatDateTime, formatQty, num, toLocalInput } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";

export default async function WeighmentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("weighments.view");
  const { id } = await params;
  const w = await prisma.weighment.findUnique({
    where: { id },
    include: { vehicle: true, driver: true, customer: true, site: true, wasteType: true, location: true, collectionEntry: true, customerInvoiceItem: { include: { invoice: true } } },
  });
  if (!w) notFound();
  const manage = user.permissions.includes("weighments.manage");
  const override = user.permissions.includes("weighments.override");
  const users = await prisma.user.findMany({ where: { id: { in: [w.createdById, w.completedById].filter(Boolean) as string[] } } });
  const uname = (uid: string | null) => users.find((u) => u.id === uid)?.name ?? "";
  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2">{w.number} <StatusBadge status={w.status} label={w.status === "GATE_IN" ? "Gate In" : undefined} />{w.isNetOverridden && <Badge tone="amber">Net overridden</Badge>}</span>}
        description={`${w.vehicle.number} · ${w.customer.name}${w.site ? ` · ${w.site.name}` : ""}`}
        crumbs={[{ href: "/weighments", label: "Weighment" }]}
        actions={
          <>
            <Button variant="outline" size="sm" asChild><a href={`/api/weighments/${id}/slip`} target="_blank"><Printer /> Print Slip</a></Button>
            {override && w.status === "COMPLETED" && !w.customerInvoiceItemId && (
              <FormDialog label="Override Net" icon={<Pencil />} title="Admin override of net weight" description="Use only to correct a weighbridge error. The reason and the old/new values are recorded in the audit trail.">
                <EntityForm
                  schemaKey="netOverride"
                  cols={1}
                  fields={[
                    { name: "netWeight", label: "Corrected Net Weight (KG)", type: "number", required: true },
                    { name: "reason", label: "Reason for override", type: "textarea", required: true },
                  ]}
                  defaultValues={{ weighmentId: id, netWeight: String(num(w.netWeight)) }}
                  action={async (v) => { "use server"; return overrideNetAction({ ...v, weighmentId: id }); }}
                  successMessage="Net weight overridden and audited"
                />
              </FormDialog>
            )}
            {manage && w.status !== "CANCELLED" && !w.customerInvoiceItemId && (
              <ConfirmAction label="Cancel" icon={<XCircle />} title={`Cancel ${w.number}?`} description={w.status === "COMPLETED" ? "The stock received from this weighment will be reversed." : undefined} requireReason action={cancelWeighmentAction.bind(null, id)} successMessage="Weighment cancelled" />
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <WeightTile label="Gross Weight" value={w.grossWeight} sub={`Gate in ${formatDateTime(w.gateInAt)}`} />
        <WeightTile label="Tare Weight" value={w.tareWeight} sub={w.gateOutAt ? `Gate out ${formatDateTime(w.gateOutAt)}` : "Awaiting gate-out"} />
        <WeightTile label="Net Weight" value={w.netWeight} highlight sub={w.isNetOverridden ? `Calculated ${formatQty(w.calculatedNetWeight)} kg · overridden: ${w.overrideReason}` : "Gross − Tare (automatic)"} />
      </div>
      {w.status === "GATE_IN" && manage && (
        <Section title="Gate Out · Tare Weight" className="mb-4">
          <CardContent>
            <GateOutForm weighmentId={id} gross={num(w.grossWeight)} defaultTare={w.vehicle.standardTareKg ? num(w.vehicle.standardTareKg) : undefined} now={toLocalInput(new Date())} />
            {w.vehicle.standardTareKg && <p className="mt-2 text-xs text-slate-500">Pre-filled with the vehicle&apos;s standard tare ({formatQty(w.vehicle.standardTareKg)} kg). Always enter the actual weighbridge reading.</p>}
          </CardContent>
        </Section>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardContent>
            <DetailGrid
              cols={2}
              items={[
                { label: "Vehicle", value: <Link className="text-navy-700 hover:underline" href={`/vehicles/${w.vehicleId}`}>{w.vehicle.number}</Link> },
                { label: "Driver", value: w.driver?.name },
                { label: "Customer", value: <Link className="text-navy-700 hover:underline" href={`/customers/${w.customerId}`}>{w.customer.name}</Link> },
                { label: "Site", value: w.site?.name },
                { label: "Waste Type", value: w.wasteType.name },
                { label: "Receiving Location", value: w.location.name },
                { label: "Weighbridge Slip", value: w.slipNumber },
                { label: "Collection", value: w.collectionEntry?.number },
                { label: "Billing", value: w.customerInvoiceItem ? <Link className="text-navy-700 hover:underline" href={`/invoices/${w.customerInvoiceItem.invoiceId}`}>{w.customerInvoiceItem.invoice.number}</Link> : "Not billed yet" },
                { label: "Created By", value: uname(w.createdById) },
                { label: "Completed By", value: uname(w.completedById) },
                { label: "Remarks", value: w.remarks },
                ...(w.cancelReason ? [{ label: "Cancel Reason", value: w.cancelReason }] : []),
              ]}
            />
          </CardContent>
        </Card>
        <DocumentsPanel entityType="weighment" entityId={id} category="WEIGHBRIDGE_SLIP" categories={["WEIGHBRIDGE_SLIP", "OTHER"]} canUpload={manage} title="Weighbridge Slip & Attachments" />
      </div>
    </>
  );
}

function WeightTile({ label, value, sub, highlight }: { label: string; value: unknown; sub?: string; highlight?: boolean }) {
  return (
    <div className={highlight ? "rounded-xl border-2 border-brand-500 bg-brand-50 p-4" : "rounded-xl border border-slate-200 bg-white p-4"}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`num mt-1 text-3xl font-bold ${highlight ? "text-brand-800" : "text-navy-800"}`} data-testid={`w-${label.split(" ")[0].toLowerCase()}`}>
        {value === null || value === undefined ? "—" : formatQty(value as number)} <span className="text-base font-medium text-slate-500">KG</span>
      </p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}
