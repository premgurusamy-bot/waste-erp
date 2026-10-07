import { Plus } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { FilterBar, FilterField, FText, PageHeader, StatCard } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { ci, flat, listParams, str, type SP } from "@/lib/list-params";
import { dateOnly, formatDate, formatQty, formatTonnes, num, todayISO } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";

export const metadata = { title: "Waste Processing" };

export default async function ProcessingPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("processing.view");
  const sp = await searchParams;
  const { page, pageSize, skip, take, q } = listParams(sp);
  const to = str(sp, "to") ?? todayISO();
  const from = str(sp, "from") ?? `${to.slice(0, 7)}-01`;
  const where = { date: { gte: dateOnly(from), lte: dateOnly(to) }, ...(q ? { OR: [{ number: ci(q) }, { batchNo: ci(q) }] } : {}) };
  const [rows, total, agg] = await Promise.all([
    prisma.processingBatch.findMany({ where, include: { location: true, inputs: { include: { item: true } }, outputs: { include: { item: true } } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], skip, take }),
    prisma.processingBatch.count({ where }),
    prisma.processingBatch.aggregate({ where: { ...where, status: "POSTED" }, _sum: { inputQty: true, outputQty: true, rejectedQty: true, lossQty: true } }),
  ]);
  const input = num(agg._sum.inputQty);
  return (
    <>
      <PageHeader title="Waste Processing" description="Segregation batches: input = recovered output + rejected + loss" actions={user.permissions.includes("processing.manage") && <Button asChild><Link href="/processing/new"><Plus /> New Batch</Link></Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Waste Processed" value={formatTonnes(input)} tone="navy" />
        <StatCard label="Recovered" value={formatTonnes(agg._sum.outputQty)} sub={input ? `${((num(agg._sum.outputQty) / input) * 100).toFixed(1)}% recovery` : undefined} />
        <StatCard label="Rejected" value={formatTonnes(agg._sum.rejectedQty)} tone="amber" sub={input ? `${((num(agg._sum.rejectedQty) / input) * 100).toFixed(1)}%` : undefined} />
        <StatCard label="Process Loss" value={formatTonnes(agg._sum.lossQty)} tone="slate" sub={input ? `${((num(agg._sum.lossQty) / input) * 100).toFixed(1)}%` : undefined} />
      </div>
      <Card>
        <FilterBar reset="/processing">
          <FilterField label="Search" className="min-w-48 flex-1"><FText name="q" defaultValue={q} placeholder="Processing ID, batch no." /></FilterField>
          <FilterField label="From"><FText type="date" name="from" defaultValue={from} /></FilterField>
          <FilterField label="To"><FText type="date" name="to" defaultValue={to} /></FilterField>
        </FilterBar>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          empty="No processing batches in this period"
          columns={[
            { key: "n", header: "Processing ID", cell: (r) => <Link href={`/processing/${r.id}`} className="font-medium text-navy-700 hover:underline">{r.number}</Link> },
            { key: "b", header: "Batch", cell: (r) => r.batchNo },
            { key: "d", header: "Date", cell: (r) => formatDate(r.date) },
            { key: "in", header: "Input", cell: (r) => r.inputs.map((i) => i.item.name.replace(" (Unprocessed)", "")).join(", ") },
            { key: "iq", header: "Input (KG)", align: "right", cell: (r) => formatQty(r.inputQty) },
            { key: "oq", header: "Recovered", align: "right", cell: (r) => formatQty(r.outputQty) },
            { key: "rq", header: "Rejected", align: "right", cell: (r) => formatQty(r.rejectedQty) },
            { key: "lq", header: "Loss", align: "right", cell: (r) => formatQty(r.lossQty) },
            { key: "rec", header: "Recovery", align: "right", cell: (r) => `${((num(r.outputQty) / num(r.inputQty)) * 100).toFixed(1)}%` },
            { key: "loc", header: "Location", hideOnMobile: true, cell: (r) => r.location.name },
            { key: "s", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
        <Pagination page={page} pageSize={pageSize} total={total} params={flat(sp)} />
      </Card>
    </>
  );
}
