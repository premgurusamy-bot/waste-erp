import { History, Pencil, Plus, XCircle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { addRateAction, cancelRateAction, reviseRateAction, saveContractAction } from "@/app/actions/contracts";
import { ConfirmAction, FormDialog } from "@/components/forms/confirm-action";
import { EntityForm } from "@/components/forms/entity-form";
import { DocumentsPanel } from "@/components/shared/documents-panel";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { DetailGrid, PageHeader, Section } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { contractFields, rateFields } from "@/lib/contract-fields";
import { toFormValues } from "@/lib/fields";
import { formatDate, formatMoney, titleCase, todayISO } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { customerOptions, gstRateOptions, wasteTypeOptions } from "@/server/options";

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("contracts.view");
  const { id } = await params;
  const c = await prisma.contract.findUnique({
    where: { id },
    include: {
      customer: { include: { sites: true } },
      rates: { include: { site: true, wasteType: true, gstRate: true, _count: { select: { invoiceItems: true } } }, orderBy: [{ billingMethod: "asc" }, { effectiveFrom: "desc" }] },
    },
  });
  if (!c) notFound();
  const manage = user.permissions.includes("contracts.manage");
  const [customers, wasteTypes, gstRates] = await Promise.all([customerOptions(true), wasteTypeOptions(), gstRateOptions()]);
  const sites = c.customer.sites.map((s) => ({ value: s.id, label: s.name }));
  const gst18 = await prisma.gstRate.findFirst({ where: { rate: 18 } });
  const active = c.rates.filter((r) => r.status === "ACTIVE");
  const history = c.rates.filter((r) => r.status !== "ACTIVE");
  const rateCols = [
    { key: "m", header: "Billing Method", cell: (r: (typeof c.rates)[number]) => titleCase(r.billingMethod) },
    { key: "scope", header: "Applies To", cell: (r: (typeof c.rates)[number]) => [r.site?.name ?? "All sites", r.wasteType?.name ?? "All waste"].join(" · ") },
    { key: "rate", header: "Rate", align: "right" as const, cell: (r: (typeof c.rates)[number]) => <b>{formatMoney(r.rate)} / {r.unit.toLowerCase()}</b> },
    { key: "tax", header: "GST", cell: (r: (typeof c.rates)[number]) => (r.taxTreatment === "EXEMPT" ? "Exempt" : r.gstRate?.name) },
    { key: "eff", header: "Effective", cell: (r: (typeof c.rates)[number]) => `${formatDate(r.effectiveFrom)} → ${r.effectiveTo ? formatDate(r.effectiveTo) : "current"}` },
    { key: "v", header: "Version", align: "center" as const, cell: (r: (typeof c.rates)[number]) => <Badge tone="blue">v{r.version}</Badge> },
    { key: "used", header: "Invoice Lines", align: "right" as const, cell: (r: (typeof c.rates)[number]) => r._count.invoiceItems },
    { key: "s", header: "Status", cell: (r: (typeof c.rates)[number]) => <StatusBadge status={r.status} /> },
  ];
  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2">{c.number} <StatusBadge status={c.status} /></span>}
        description={`${c.customer.name} · ${c.title}`}
        crumbs={[{ href: "/contracts", label: "Contracts" }]}
        actions={
          manage && (
            <FormDialog label="Edit Contract" icon={<Pencil />} title={`Edit ${c.number}`} wide>
              <EntityForm schemaKey="contract" fields={contractFields(customers, true)} defaultValues={toFormValues(c)} action={saveContractAction.bind(null, id)} cols={2} successMessage="Contract updated" />
            </FormDialog>
          )
        }
      />
      <Card className="mb-4">
        <CardContent>
          <DetailGrid
            cols={4}
            items={[
              { label: "Customer", value: <Link className="text-navy-700 hover:underline" href={`/customers/${c.customerId}`}>{c.customer.name}</Link> },
              { label: "Start Date", value: formatDate(c.startDate) },
              { label: "End Date", value: c.endDate ? formatDate(c.endDate) : "Open ended" },
              { label: "Payment Terms", value: `${c.paymentTermsDays} days` },
              { label: "Remarks", value: c.remarks },
            ]}
          />
        </CardContent>
      </Card>
      <Section
        title="Current Rates"
        className="mb-4"
        actions={
          manage && (
            <FormDialog label="Add Rate" icon={<Plus />} title="Add rate" description="Rates apply from the effective date. Use 'Revise' to change a rate later — history is kept." variant="default" wide>
              <EntityForm
                schemaKey="rate"
                cols={2}
                fields={rateFields(sites, wasteTypes, gstRates)}
                defaultValues={{ contractId: id, effectiveFrom: c.startDate.toISOString().slice(0, 10) > todayISO() ? c.startDate.toISOString().slice(0, 10) : todayISO(), taxTreatment: "TAXABLE", gstRateId: gst18?.id ?? "", billingMethod: "WEIGHT", unit: "KG", sacCode: "999432" }}
                action={async (v) => { "use server"; return addRateAction({ ...v, contractId: id }); }}
                successMessage="Rate added"
              />
            </FormDialog>
          )
        }
      >
        <DataTable
          rows={active}
          rowKey={(r) => r.id}
          empty="No active rates — add one so this customer can be billed"
          columns={[
            ...rateCols,
            ...(manage
              ? [
                  {
                    key: "act",
                    header: "",
                    cell: (r: (typeof c.rates)[number]) => { const rid = r.id; return (
                      <div className="flex justify-end gap-1">
                        <FormDialog label="Revise" icon={<History />} title={`Revise rate (currently ${formatMoney(r.rate)}/${r.unit.toLowerCase()})`} description="The current version closes the day before the new effective date. Billed invoices are not affected.">
                          <EntityForm
                            schemaKey="rateRevision"
                            cols={2}
                            fields={[
                              { name: "rate", label: "New Rate (₹)", type: "number", required: true },
                              { name: "effectiveFrom", label: "Effective From", type: "date", required: true },
                              { name: "gstRateId", label: "GST Rate", type: "select", options: gstRates },
                              { name: "description", label: "Invoice Description", type: "textarea" },
                            ]}
                            defaultValues={{ rateId: r.id, gstRateId: r.gstRateId ?? "", description: r.description ?? "", effectiveFrom: todayISO() }}
                            action={async (v) => { "use server"; return reviseRateAction({ ...v, rateId: rid }); }}
                            successMessage="Rate revised"
                          />
                        </FormDialog>
                        {r._count.invoiceItems === 0 && (
                          <ConfirmAction label="Cancel" icon={<XCircle />} title="Cancel this rate?" requireReason action={cancelRateAction.bind(null, r.id)} successMessage="Rate cancelled" />
                        )}
                      </div>
                    ); },
                  },
                ]
              : []),
          ]}
        />
      </Section>
      {history.length > 0 && (
        <Section title="Rate History (previous versions)" className="mb-4">
          <DataTable rows={history} rowKey={(r) => r.id} columns={rateCols} dense />
        </Section>
      )}
      <DocumentsPanel entityType="contract" entityId={id} category="CUSTOMER_AGREEMENT" categories={["CUSTOMER_AGREEMENT", "OTHER"]} canUpload={manage || user.permissions.includes("documents.manage")} title="Signed Agreement & Attachments" />
    </>
  );
}
