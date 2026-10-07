import { XCircle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cancelPaymentAction } from "@/app/actions/receipts";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { DetailGrid, PageHeader, Section } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { formatDate, formatMoney, titleCase } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("receipts.view");
  const { id } = await params;
  const p = await prisma.payment.findUnique({ where: { id }, include: { supplier: true, account: true, allocations: { include: { purchase: true, expense: true } } } });
  if (!p) notFound();
  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2">{p.number} <StatusBadge status={p.status} /></span>}
        description={`${p.supplier.name} · ${formatDate(p.date)} · ${formatMoney(p.amount)}`}
        crumbs={[{ href: "/payments", label: "Payments" }]}
        actions={user.permissions.includes("receipts.manage") && p.status === "POSTED" && (
          <ConfirmAction label="Cancel Payment" icon={<XCircle />} title={`Cancel ${p.number}?`} requireReason action={cancelPaymentAction.bind(null, id)} successMessage="Payment cancelled" />
        )}
      />
      <Card className="mb-4"><CardContent>
        <DetailGrid cols={4} items={[
          { label: "Supplier", value: <Link className="text-navy-700 hover:underline" href={`/suppliers/${p.supplierId}`}>{p.supplier.name}</Link> },
          { label: "Mode", value: titleCase(p.mode) },
          { label: "Reference", value: p.reference },
          { label: "Paid From", value: p.account.name },
          { label: "Amount", value: <b>{formatMoney(p.amount)}</b> },
          { label: "Remarks", value: p.remarks ?? p.cancelReason },
        ]} />
      </CardContent></Card>
      <Section title="Allocated Bills">
        <DataTable rows={p.allocations} rowKey={(a) => a.id} empty="Advance payment (not allocated)" columns={[
          { key: "n", header: "Bill", cell: (a) => (a.purchase ? <Link className="text-navy-700 hover:underline" href={`/purchases/${a.purchaseId}`}>{a.purchase.number}</Link> : <Link className="text-navy-700 hover:underline" href={`/expenses/${a.expenseId}`}>{a.expense?.number}</Link>) },
          { key: "d", header: "Date", cell: (a) => formatDate(a.purchase?.date ?? a.expense?.date) },
          { key: "t", header: "Bill Total", align: "right", cell: (a) => formatMoney(a.purchase?.total ?? a.expense?.total) },
          { key: "a", header: "Allocated", align: "right", cell: (a) => <b>{formatMoney(a.amount)}</b> },
        ]} />
      </Section>
    </>
  );
}
