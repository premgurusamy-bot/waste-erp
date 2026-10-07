import { FileDown, Printer, XCircle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cancelSalesAction } from "@/app/actions/trade";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { DocLines } from "@/components/shared/doc-lines";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { DetailGrid, PageHeader, Section } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { formatDate, formatMoney, num } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";

export default async function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("sales.view");
  const { id } = await params;
  const s = await prisma.salesInvoice.findUnique({ where: { id }, include: { buyer: true, location: true, items: { include: { item: true } }, allocations: { include: { receipt: true } } } });
  if (!s) notFound();
  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2">{s.number} <StatusBadge status={s.status === "CANCELLED" ? "CANCELLED" : s.paymentStatus} /></span>}
        description={`${s.buyer.name} · ${formatDate(s.date)}`}
        crumbs={[{ href: "/sales", label: "Sales" }]}
        actions={
          <>
            <Button variant="outline" size="sm" asChild><a href={`/api/sales/${id}/pdf`} target="_blank"><Printer /> Print</a></Button>
            <Button variant="outline" size="sm" asChild><a href={`/api/sales/${id}/pdf?download=1`}><FileDown /> PDF</a></Button>
            {user.permissions.includes("receipts.manage") && s.status === "POSTED" && s.paymentStatus !== "PAID" && <Button size="sm" asChild><Link href={`/receipts/new?buyerId=${s.buyerId}`}>Record Receipt</Link></Button>}
            {user.permissions.includes("sales.manage") && s.status === "POSTED" && num(s.amountReceived) === 0 && (
              <ConfirmAction label="Cancel Sale" icon={<XCircle />} title={`Cancel ${s.number}?`} description="Stock will be returned and the accounting entry reversed." requireReason action={cancelSalesAction.bind(null, id)} successMessage="Sale cancelled" />
            )}
          </>
        }
      />
      <Card className="mb-4"><CardContent>
        <DetailGrid cols={4} items={[
          { label: "Buyer", value: <Link className="text-navy-700 hover:underline" href={`/buyers/${s.buyerId}`}>{s.buyer.name}</Link> },
          { label: "GSTIN", value: s.buyer.gstin },
          { label: "Stock Location", value: s.location.name },
          { label: "Buyer Vehicle", value: s.vehicleNumber },
          { label: "Due Date", value: formatDate(s.dueDate) },
          { label: "Received", value: formatMoney(s.amountReceived) },
          { label: "Balance", value: formatMoney(num(s.total) - num(s.amountReceived)) },
          { label: "Remarks", value: s.remarks ?? s.cancelReason },
        ]} />
      </CardContent></Card>
      <Section title="Materials" className="mb-4">
        <DocLines inter={s.isInterState} lines={s.items.map((i) => ({ ...i, description: i.description ?? i.item.name }))} totals={s} />
      </Section>
      {s.allocations.length > 0 && (
        <Section title="Receipts">
          <DataTable rows={s.allocations} rowKey={(a) => a.id} columns={[
            { key: "n", header: "Receipt", cell: (a) => <Link className="text-navy-700 hover:underline" href={`/receipts/${a.receiptId}`}>{a.receipt.number}</Link> },
            { key: "d", header: "Date", cell: (a) => formatDate(a.receipt.date) },
            { key: "a", header: "Amount", align: "right", cell: (a) => formatMoney(a.amount) },
            { key: "s", header: "Status", cell: (a) => <StatusBadge status={a.receipt.status} /> },
          ]} />
        </Section>
      )}
    </>
  );
}
