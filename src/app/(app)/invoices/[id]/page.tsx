import { FileDown, Mail, Printer, XCircle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cancelInvoiceAction } from "@/app/actions/billing";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { EmailInvoiceButton } from "@/components/shared/email-invoice";
import { DocLines } from "@/components/shared/doc-lines";
import { DocumentsPanel } from "@/components/shared/documents-panel";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { DetailGrid, PageHeader, Section } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime, formatMoney, formatQty, num } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { emailConfigured } from "@/server/mail";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("billing.view");
  const { id } = await params;
  const inv = await prisma.customerInvoice.findUnique({
    where: { id },
    include: {
      customer: true, site: true, contract: true,
      items: { include: { weighments: { include: { vehicle: true } }, collectionEntries: { include: { vehicle: true } }, customerRate: true } },
      allocations: { include: { receipt: true } },
    },
  });
  if (!inv) notFound();
  const manage = user.permissions.includes("billing.manage");
  const balance = num(inv.total) - num(inv.amountReceived);
  const weighments = inv.items.flatMap((i) => i.weighments);
  const trips = inv.items.flatMap((i) => i.collectionEntries);
  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2">{inv.number} <StatusBadge status={inv.status === "CANCELLED" ? "CANCELLED" : inv.paymentStatus} />{inv.emailedAt && <Badge tone="blue">Emailed</Badge>}</span>}
        description={`${inv.customer.name} · ${formatDate(inv.date)}`}
        crumbs={[{ href: "/invoices", label: "Invoices" }]}
        actions={
          <>
            <Button variant="outline" size="sm" asChild><a href={`/api/invoices/${id}/pdf`} target="_blank"><Printer /> Print</a></Button>
            <Button variant="outline" size="sm" asChild><a href={`/api/invoices/${id}/pdf?download=1`}><FileDown /> Download PDF</a></Button>
            {manage && <EmailInvoiceButton id={id} defaultTo={inv.customer.email ?? ""} configured={emailConfigured()} icon={<Mail />} />}
            {user.permissions.includes("receipts.manage") && inv.status === "POSTED" && balance > 0 && <Button size="sm" asChild><Link href={`/receipts/new?customerId=${inv.customerId}`}>Record Payment</Link></Button>}
            {manage && inv.status === "POSTED" && num(inv.amountReceived) === 0 && (
              <ConfirmAction label="Cancel Invoice" icon={<XCircle />} title={`Cancel ${inv.number}?`} description="The accounting entry is reversed and the billed weighments/trips become billable again." requireReason action={cancelInvoiceAction.bind(null, id)} successMessage="Invoice cancelled" />
            )}
          </>
        }
      />
      <Card className="mb-4"><CardContent>
        <DetailGrid cols={4} items={[
          { label: "Customer", value: <Link className="text-navy-700 hover:underline" href={`/customers/${inv.customerId}`}>{inv.customer.name}</Link> },
          { label: "GSTIN", value: inv.customer.gstin },
          { label: "Site", value: inv.site?.name ?? "All sites" },
          { label: "Contract", value: inv.contract ? <Link className="text-navy-700 hover:underline" href={`/contracts/${inv.contractId}`}>{inv.contract.number}</Link> : null },
          { label: "Billing Period", value: inv.periodFrom ? `${formatDate(inv.periodFrom)} to ${formatDate(inv.periodTo)}` : null },
          { label: "Due Date", value: `${formatDate(inv.dueDate)} (${inv.paymentTermsDays} days)` },
          { label: "Received", value: formatMoney(inv.amountReceived) },
          { label: "Balance", value: <b className={balance > 0 ? "text-amber-700" : ""}>{formatMoney(inv.status === "CANCELLED" ? 0 : balance)}</b> },
          ...(inv.cancelReason ? [{ label: "Cancel Reason", value: inv.cancelReason }] : []),
          ...(inv.emailedAt ? [{ label: "Emailed", value: formatDateTime(inv.emailedAt) }] : []),
        ]} />
      </CardContent></Card>
      <Section title="Invoice Lines" className="mb-4"><DocLines inter={inv.isInterState} lines={inv.items} totals={inv} /></Section>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title={`Billed Weighments (${weighments.length}) & Trips (${trips.length})`}>
          <DataTable
            dense
            rows={[...weighments.map((w) => ({ id: w.id, kind: "Weighment", no: w.number, href: `/weighments/${w.id}`, date: w.gateInAt, vehicle: w.vehicle.number, qty: `${formatQty(w.netWeight)} kg` })), ...trips.map((t) => ({ id: t.id, kind: "Trip", no: t.number, href: "", date: t.collectionDate, vehicle: t.vehicle.number, qty: "1 trip" }))]}
            rowKey={(r) => r.id}
            empty="Monthly / manual charges only"
            columns={[
              { key: "k", header: "Type", cell: (r) => r.kind },
              { key: "n", header: "Number", cell: (r) => (r.href ? <Link className="text-navy-700 hover:underline" href={r.href}>{r.no}</Link> : r.no) },
              { key: "d", header: "Date", cell: (r) => formatDateTime(r.date) },
              { key: "v", header: "Vehicle", cell: (r) => r.vehicle },
              { key: "q", header: "Quantity", align: "right", cell: (r) => r.qty },
            ]}
          />
        </Section>
        <div className="space-y-4">
          <Section title="Payments Received">
            <DataTable dense rows={inv.allocations} rowKey={(a) => a.id} empty="No payments yet" columns={[
              { key: "n", header: "Receipt", cell: (a) => <Link className="text-navy-700 hover:underline" href={`/receipts/${a.receiptId}`}>{a.receipt.number}</Link> },
              { key: "d", header: "Date", cell: (a) => formatDate(a.receipt.date) },
              { key: "a", header: "Amount", align: "right", cell: (a) => formatMoney(a.amount) },
              { key: "s", header: "Status", cell: (a) => <StatusBadge status={a.receipt.status} /> },
            ]} />
          </Section>
          <DocumentsPanel entityType="invoice" entityId={id} category="INVOICE" categories={["INVOICE", "OTHER"]} canUpload={manage || user.permissions.includes("documents.manage")} />
        </div>
      </div>
    </>
  );
}
