import { XCircle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cancelPurchaseAction } from "@/app/actions/trade";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { DocLines } from "@/components/shared/doc-lines";
import { DocumentsPanel } from "@/components/shared/documents-panel";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DetailGrid, PageHeader, Section } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { formatDate, formatMoney, num } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";

export default async function PurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("purchases.view");
  const { id } = await params;
  const p = await prisma.purchase.findUnique({ where: { id }, include: { supplier: true, location: true, items: true, allocations: { include: { payment: true } } } });
  if (!p) notFound();
  const manage = user.permissions.includes("purchases.manage");
  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2">{p.number} <StatusBadge status={p.status === "CANCELLED" ? "CANCELLED" : p.paymentStatus} /></span>}
        description={`${p.supplier.name} · ${formatDate(p.date)}`}
        crumbs={[{ href: "/purchases", label: "Purchases" }]}
        actions={
          <>
            {user.permissions.includes("receipts.manage") && p.status === "POSTED" && p.paymentStatus !== "PAID" && <Button size="sm" asChild><Link href={`/payments/new?supplierId=${p.supplierId}`}>Pay Supplier</Link></Button>}
            {manage && p.status === "POSTED" && num(p.amountPaid) === 0 && (
              <ConfirmAction label="Cancel" icon={<XCircle />} title={`Cancel ${p.number}?`} description="Stock received will be reversed and the accounting entry cancelled." requireReason action={cancelPurchaseAction.bind(null, id)} successMessage="Purchase cancelled" />
            )}
          </>
        }
      />
      <Card className="mb-4"><CardContent>
        <DetailGrid cols={4} items={[
          { label: "Supplier", value: <Link className="text-navy-700 hover:underline" href={`/suppliers/${p.supplierId}`}>{p.supplier.name}</Link> },
          { label: "Supplier Bill", value: [p.billNumber, p.billDate ? formatDate(p.billDate) : null].filter(Boolean).join(" · ") },
          { label: "Received at", value: p.location?.name },
          { label: "Due Date", value: formatDate(p.dueDate) },
          { label: "Paid", value: formatMoney(p.amountPaid) },
          { label: "Balance", value: formatMoney(num(p.total) - num(p.amountPaid)) },
          { label: "Payments", value: p.allocations.map((a) => a.payment.number).join(", ") },
          { label: "Remarks", value: p.remarks ?? p.cancelReason },
        ]} />
      </CardContent></Card>
      <Section title="Items" className="mb-4"><DocLines inter={p.isInterState} lines={p.items} totals={p} /></Section>
      <DocumentsPanel entityType="purchase" entityId={id} category="PURCHASE_BILL" categories={["PURCHASE_BILL", "OTHER"]} canUpload={manage || user.permissions.includes("documents.manage")} title="Purchase Bill & Attachments" />
    </>
  );
}
