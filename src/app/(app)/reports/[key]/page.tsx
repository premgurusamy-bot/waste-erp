import { FileDown, FileSpreadsheet, FileText } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { PrintButton } from "@/components/shared/print-button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/data-table";
import { FilterBar, FilterField, FSelect, FText, PageHeader } from "@/components/ui/page";
import { str, type SP } from "@/lib/list-params";
import { cn, formatDate } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { formatCell } from "@/server/export";
import { customerOptions, driverOptions, vehicleOptions, wasteTypeOptions } from "@/server/options";
import { parseReportFilters } from "@/server/report-filters";
import { canRun, getReport, runReport } from "@/server/reports";

const MAX_ROWS = 500;

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }) {
  return { title: getReport((await params).key)?.title ?? "Report" };
}

export default async function ReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<SP> }) {
  const user = await requirePermission("reports.view");
  const { key } = await params;
  const report = getReport(key);
  if (!report) notFound();
  if (!canRun(report, user.permissions)) redirect(`/forbidden?p=${report.permissions.join(",")}`);
  const sp = await searchParams;
  const f = parseReportFilters((k) => str(sp, k));
  const has = (k: string) => (report.filters as string[]).includes(k);
  const [{ rows, totals }, customers, wasteTypes, vehicles, drivers] = await Promise.all([
    runReport(report, f),
    has("customer") ? customerOptions(true) : [],
    has("wasteType") ? wasteTypeOptions() : [],
    has("vehicle") ? vehicleOptions(true) : [],
    has("driver") ? driverOptions() : [],
  ]);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  const right = (t?: string) => ["money", "qty", "int", "pct"].includes(t ?? "");
  const shown = rows.slice(0, MAX_ROWS);
  return (
    <>
      <PageHeader
        title={report.title}
        description={`${report.description} · ${formatDate(f.from)} to ${formatDate(f.to)}`}
        crumbs={[{ href: "/reports", label: "Reports" }]}
        actions={
          <>
            <a href={`/api/reports/${key}/export?format=xlsx&${qs}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium hover:bg-slate-50"><FileSpreadsheet className="size-4 text-brand-600" /> Excel</a>
            <a href={`/api/reports/${key}/export?format=csv&${qs}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium hover:bg-slate-50"><FileText className="size-4" /> CSV</a>
            <a href={`/api/reports/${key}/export?format=pdf&${qs}`} target="_blank" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium hover:bg-slate-50"><FileDown className="size-4 text-red-600" /> PDF</a>
            <PrintButton />
          </>
        }
      />
      <Card className="print-area">
        <FilterBar reset={`/reports/${key}`}>
          {has("date") && (
            <>
              <FilterField label="From"><FText type="date" name="from" defaultValue={f.from} /></FilterField>
              <FilterField label="To"><FText type="date" name="to" defaultValue={f.to} /></FilterField>
            </>
          )}
          {has("customer") && <FilterField label="Customer"><FSelect name="customerId" defaultValue={f.customerId} options={customers} /></FilterField>}
          {has("wasteType") && <FilterField label="Waste Type"><FSelect name="wasteTypeId" defaultValue={f.wasteTypeId} options={wasteTypes} /></FilterField>}
          {has("vehicle") && <FilterField label="Vehicle"><FSelect name="vehicleId" defaultValue={f.vehicleId} options={vehicles} /></FilterField>}
          {has("driver") && <FilterField label="Driver"><FSelect name="driverId" defaultValue={f.driverId} options={drivers} /></FilterField>}
          {has("q") && <FilterField label="Search" className="min-w-44 flex-1"><FText name="q" defaultValue={f.q} placeholder="Search text columns" /></FilterField>}
        </FilterBar>
        <div className="hidden px-4 pt-3 text-sm font-semibold print:block">{report.title} · {formatDate(f.from)} to {formatDate(f.to)}</div>
        {rows.length === 0 ? (
          <EmptyState title="No data for the selected filters" hint="Try a wider date range." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="report-table">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {report.columns.map((c) => <th key={c.key} className={cn("whitespace-nowrap px-4 py-2.5", right(c.type) && "text-right")}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody className="num divide-y divide-slate-100">
                {shown.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50/70">
                    {report.columns.map((c) => <td key={c.key} className={cn("px-4 py-2", right(c.type) && "text-right", c.key === "changes" && "max-w-md truncate text-xs")}>{formatCell(r[c.key], c.type)}</td>)}
                  </tr>
                ))}
              </tbody>
              {Object.keys(totals).length > 0 && (
                <tfoot>
                  <tr className="num border-t-2 border-slate-200 bg-brand-50/60 font-semibold">
                    {report.columns.map((c, i) => <td key={c.key} className={cn("px-4 py-2.5", right(c.type) && "text-right")}>{i === 0 ? "Total" : totals[c.key] !== undefined ? formatCell(totals[c.key], c.type) : ""}</td>)}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
        {rows.length > MAX_ROWS && <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Showing first {MAX_ROWS} of {rows.length} rows. Totals include all rows. Export to Excel for the full list.</p>}
      </Card>
    </>
  );
}
