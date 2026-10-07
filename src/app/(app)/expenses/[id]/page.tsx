import { XCircle } from "lucide-react";
import { notFound } from "next/navigation";
import { cancelExpenseAction } from "@/app/actions/trade";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { DocumentsPanel } from "@/components/shared/documents-panel";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DetailGrid, PageHeader } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { formatDate, formatMoney, num, titleCase } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";

export default async function ExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("expenses.view");
  const { id } = await params;
  const e = await prisma.expense.findUnique({ where: { id }, include: { category: true, supplier: true, vehicle: true, account: true, allocations: { include: { payment: true } } } });
  if (!e) notFound();
  const manage = user.permissions.includes("expenses.manage");
  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2">{e.number} <StatusBadge status={e.status === "CANCELLED" ? "CANCELLED" : e.paymentStatus} /></span>}
        description={`${e.category.name} · ${formatDate(e.date)}`}
        crumbs={[{ href: "/expenses", label: "Expenses" }]}
        actions={manage && e.status === "POSTED" && e.allocations.length === 0 && (
          <ConfirmAction label="Cancel" icon={<XCircle />} title={`Cancel ${e.number}?`} description="The accounting entry will be reversed." requireReason action={cancelExpenseAction.bind(null, id)} successMessage="Expense cancelled" />
        )}
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card><CardContent>
          <DetailGrid cols={2} items={[
            { label: "Category", value: e.category.name },
            { label: "Supplier / Payee", value: e.supplier?.name },
            { label: "Vehicle", value: e.vehicle?.number },
            { label: "Description", value: e.description },
            { label: "Amount", value: formatMoney(e.amount) },
            { label: `GST (${num(e.gstRate)}%)`, value: formatMoney(num(e.cgst) + num(e.sgst) + num(e.igst)) },
            { label: "Total", value: <b>{formatMoney(e.total)}</b> },
            { label: "Payment Mode", value: titleCase(e.paymentMode) },
            { label: "Paid From", value: e.account?.name },
            { label: "Reference", value: e.reference },
            { label: "Paid", value: formatMoney(e.amountPaid) },
            { label: "Supplier Payments", value: e.allocations.map((a) => a.payment.number).join(", ") },
            { label: "Remarks", value: e.remarks ?? e.cancelReason },
          ]} />
        </CardContent></Card>
        <DocumentsPanel entityType="expense" entityId={id} category="EXPENSE_BILL" categories={["EXPENSE_BILL", "OTHER"]} canUpload={manage || user.permissions.includes("documents.manage")} title="Expense Bill & Attachments" />
      </div>
    </>
  );
}
