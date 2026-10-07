import { DataTable } from "@/components/ui/data-table";
import { formatMoney, formatQty, num } from "@/lib/utils";

type L = { id: string; description: string | null; hsnCode?: string | null; sacCode?: string | null; quantity: unknown; unit: string; rate: unknown; taxableValue: unknown; gstRate: unknown; cgst: unknown; sgst: unknown; igst: unknown; total: unknown };

/** Invoice-style line table with totals footer. */
export function DocLines({ lines, totals, inter }: { lines: L[]; totals: { subtotal: unknown; cgst: unknown; sgst: unknown; igst: unknown; roundOff: unknown; total: unknown }; inter: boolean }) {
  return (
    <>
      <DataTable
        rows={lines}
        rowKey={(l) => l.id}
        columns={[
          { key: "d", header: "Description", cell: (l) => <div><div>{l.description}</div>{(l.hsnCode || l.sacCode) && <div className="text-xs text-slate-500">HSN/SAC {l.hsnCode ?? l.sacCode}</div>}</div> },
          { key: "q", header: "Quantity", align: "right", cell: (l) => `${formatQty(l.quantity as number)} ${l.unit}` },
          { key: "r", header: "Rate", align: "right", cell: (l) => formatMoney(l.rate as number) },
          { key: "t", header: "Taxable", align: "right", cell: (l) => formatMoney(l.taxableValue as number) },
          { key: "g", header: "GST %", align: "right", cell: (l) => `${num(l.gstRate as number)}%` },
          ...(inter
            ? [{ key: "i", header: "IGST", align: "right" as const, cell: (l: L) => formatMoney(l.igst as number) }]
            : [
                { key: "c", header: "CGST", align: "right" as const, cell: (l: L) => formatMoney(l.cgst as number) },
                { key: "s", header: "SGST", align: "right" as const, cell: (l: L) => formatMoney(l.sgst as number) },
              ]),
          { key: "tot", header: "Total", align: "right", cell: (l) => <b>{formatMoney(l.total as number)}</b> },
        ]}
      />
      <div className="flex justify-end border-t border-slate-100 px-5 py-3">
        <dl className="num grid grid-cols-[auto_9rem] gap-x-8 gap-y-1 text-sm">
          <dt className="text-slate-500">Taxable value</dt><dd className="text-right">{formatMoney(totals.subtotal as number)}</dd>
          {inter ? (<><dt className="text-slate-500">IGST</dt><dd className="text-right">{formatMoney(totals.igst as number)}</dd></>) : (<><dt className="text-slate-500">CGST</dt><dd className="text-right">{formatMoney(totals.cgst as number)}</dd><dt className="text-slate-500">SGST</dt><dd className="text-right">{formatMoney(totals.sgst as number)}</dd></>)}
          {num(totals.roundOff as number) !== 0 && (<><dt className="text-slate-500">Round off</dt><dd className="text-right">{formatMoney(totals.roundOff as number)}</dd></>)}
          <dt className="font-semibold text-navy-800">Total</dt><dd className="text-right text-base font-semibold text-navy-800">{formatMoney(totals.total as number)}</dd>
        </dl>
      </div>
    </>
  );
}
