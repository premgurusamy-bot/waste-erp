import { XCircle } from "lucide-react";
import { notFound } from "next/navigation";
import { cancelProcessingAction } from "@/app/actions/stock";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { DetailGrid, PageHeader, Section, StatCard } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime, formatQty, num } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("processing.view");
  const { id } = await params;
  const b = await prisma.processingBatch.findUnique({ where: { id }, include: { location: true, inputs: { include: { item: true } }, outputs: { include: { item: true } } } });
  if (!b) notFound();
  const stock = await prisma.inventoryTransaction.findMany({ where: { refType: "PROCESSING", refId: id }, include: { item: true, location: true }, orderBy: { createdAt: "asc" } });
  const pct = (v: unknown) => `${((num(v as number) / num(b.inputQty)) * 100).toFixed(1)}%`;
  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2">{b.number} <StatusBadge status={b.status} /></span>}
        description={`Batch ${b.batchNo} · ${formatDate(b.date)} · ${b.location.name}`}
        crumbs={[{ href: "/processing", label: "Processing" }]}
        actions={user.permissions.includes("processing.manage") && b.status === "POSTED" && (
          <ConfirmAction label="Cancel Batch" icon={<XCircle />} title={`Cancel ${b.number}?`} description="All stock movements of this batch will be reversed. Not possible if recovered material was already sold." requireReason action={cancelProcessingAction.bind(null, id)} successMessage="Batch cancelled and stock reversed" />
        )}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Input" value={`${formatQty(b.inputQty)} kg`} tone="navy" />
        <StatCard label="Recovered Output" value={`${formatQty(b.outputQty)} kg`} sub={pct(b.outputQty)} />
        <StatCard label="Rejected" value={`${formatQty(b.rejectedQty)} kg`} sub={pct(b.rejectedQty)} tone="amber" />
        <StatCard label="Process Loss" value={`${formatQty(b.lossQty)} kg`} sub={pct(b.lossQty)} tone="slate" />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title="Inputs">
          <DataTable rows={b.inputs} rowKey={(r) => r.id} columns={[{ key: "i", header: "Material", cell: (r) => r.item.name }, { key: "q", header: "Quantity (KG)", align: "right", cell: (r) => formatQty(r.quantity) }]} />
        </Section>
        <Section title="Recovered Outputs">
          <DataTable rows={b.outputs} rowKey={(r) => r.id} empty="No recovered material" columns={[{ key: "i", header: "Material", cell: (r) => r.item.name }, { key: "q", header: "Quantity (KG)", align: "right", cell: (r) => formatQty(r.quantity) }, { key: "p", header: "% of input", align: "right", cell: (r) => pct(r.quantity) }]} />
        </Section>
        <Section title="Stock Movements (traceability)" className="xl:col-span-2">
          <DataTable
            rows={stock}
            rowKey={(r) => r.id}
            dense
            columns={[
              { key: "t", header: "Posted", cell: (r) => formatDateTime(r.createdAt) },
              { key: "ty", header: "Type", cell: (r) => r.txnType.replace("_", " ") },
              { key: "i", header: "Material", cell: (r) => r.item.name },
              { key: "l", header: "Location", cell: (r) => r.location.name },
              { key: "q", header: "Quantity", align: "right", cell: (r) => <span className={num(r.quantity) < 0 ? "text-red-600" : "text-brand-700"}>{num(r.quantity) > 0 ? "+" : ""}{formatQty(r.quantity)}</span> },
              { key: "rm", header: "Remarks", cell: (r) => r.remarks },
            ]}
          />
        </Section>
        {(b.remarks || b.cancelReason) && (
          <Card className="xl:col-span-2"><CardContent><DetailGrid items={[{ label: "Remarks", value: b.remarks }, { label: "Cancel Reason", value: b.cancelReason }]} /></CardContent></Card>
        )}
      </div>
    </>
  );
}
