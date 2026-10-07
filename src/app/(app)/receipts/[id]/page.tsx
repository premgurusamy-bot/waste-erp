import { Link2, XCircle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cancelReceiptAction } from "@/app/actions/receipts";
import { ConfirmAction, FormDialog } from "@/components/forms/confirm-action";
import { MoneyForm } from "@/components/forms/money-form";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { DetailGrid, PageHeader, Section } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime, formatMoney, num, round2, titleCase, todayISO } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("receipts.view");
  const { id } = await params;
  const r = await prisma.receipt.findUnique({ where: { id }, include: { customer: true, buyer: true, account: true, allocations: { include: { customerInvoice: true, salesInvoice: true } } } });
  if (!r) notFound();
  const manage = user.permissions.includes("receipts.manage");
  const unallocated = round2(num(r.amount) - num(r.allocatedAmount));
  const partyId = (r.customerId ?? r.buyerId)!;
  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2">{r.number} <StatusBadge status={r.status} /></span>}
        description={`${r.customer?.name ?? r.buyer?.name} · ${formatDate(r.date)} · ${formatMoney(r.amount)}`}
        crumbs={[{ href: "/receipts", label: "Receipts" }]}
        actions={
          manage && r.status === "POSTED" && (
            <>
              {unallocated > 0 && (
                <FormDialog label="Allocate Advance" icon={<Link2 />} title={`Allocate ${formatMoney(unallocated)} to invoices`} variant="default" wide>
                  <MoneyForm kind="allocate" accounts={[]} defaults={{ date: todayISO() }} allocateReceipt={{ id, partyType: r.partyType as "CUSTOMER" | "BUYER", partyId, available: unallocated }} />
                </FormDialog>
              )}
              <ConfirmAction label="Cancel Receipt" icon={<XCircle />} title={`Cancel ${r.number}?`} description="Allocations are removed (invoices become unpaid again) and the accounting entry is reversed." requireReason action={cancelReceiptAction.bind(null, id)} successMessage="Receipt cancelled" />
            </>
          )
        }
      />
      <Card className="mb-4"><CardContent>
        <DetailGrid cols={4} items={[
          { label: "Received From", value: r.customer ? <Link className="text-navy-700 hover:underline" href={`/customers/${r.customerId}`}>{r.customer.name}</Link> : <Link className="text-navy-700 hover:underline" href={`/buyers/${r.buyerId}`}>{r.buyer?.name}</Link> },
          { label: "Party Type", value: titleCase(r.partyType) },
          { label: "Mode", value: titleCase(r.mode) },
          { label: "Reference", value: r.reference },
          { label: "Deposited To", value: r.account.name },
          { label: "Amount", value: <b>{formatMoney(r.amount)}</b> },
          { label: "Allocated", value: formatMoney(r.allocatedAmount) },
          { label: "Unallocated (advance)", value: formatMoney(unallocated) },
          { label: "Recorded", value: formatDateTime(r.createdAt) },
          { label: "Remarks", value: r.remarks ?? r.cancelReason },
        ]} />
      </CardContent></Card>
      <Section title="Allocations">
        <DataTable
          rows={r.allocations}
          rowKey={(a) => a.id}
          empty="Not allocated to any invoice (advance)"
          columns={[
            { key: "n", header: "Invoice", cell: (a) => a.customerInvoice ? <Link className="text-navy-700 hover:underline" href={`/invoices/${a.customerInvoiceId}`}>{a.customerInvoice.number}</Link> : <Link className="text-navy-700 hover:underline" href={`/sales/${a.salesInvoiceId}`}>{a.salesInvoice?.number}</Link> },
            { key: "d", header: "Invoice Date", cell: (a) => formatDate(a.customerInvoice?.date ?? a.salesInvoice?.date) },
            { key: "t", header: "Invoice Total", align: "right", cell: (a) => formatMoney(a.customerInvoice?.total ?? a.salesInvoice?.total) },
            { key: "a", header: "Allocated", align: "right", cell: (a) => <b>{formatMoney(a.amount)}</b> },
            { key: "s", header: "Invoice Status", cell: (a) => <StatusBadge status={(a.customerInvoice ?? a.salesInvoice)!.paymentStatus} /> },
          ]}
        />
      </Section>
    </>
  );
}
