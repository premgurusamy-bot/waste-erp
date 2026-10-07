import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { getCtx } from "@/server/auth/current-user";
import { PermissionError, toActionError } from "@/server/errors";
import { fileResponse, MIME, toCsv, toPdf, toXlsx } from "@/server/export";
import { parseReportFilters } from "@/server/report-filters";
import { canRun, getReport, runReport } from "@/server/reports";

export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const ctx = await getCtx();
    const { key } = await params;
    const report = getReport(key);
    if (!report) return NextResponse.json({ error: "Unknown report" }, { status: 404 });
    if (!canRun(report, [...ctx.permissions])) throw new PermissionError();
    const u = new URL(req.url);
    const f = parseReportFilters((k) => u.searchParams.get(k) ?? undefined);
    const { rows, totals } = await runReport(report, f);
    const table = { title: report.title, subtitle: `${formatDate(f.from)} to ${formatDate(f.to)}${f.q ? ` · search "${f.q}"` : ""}`, columns: report.columns, rows, totals };
    const name = `${report.key}_${f.from}_${f.to}`;
    await prisma.auditLog.create({ data: { userId: ctx.userId, username: ctx.username, action: "EXPORT", module: "reports", recordId: key, recordLabel: `${report.title} (${u.searchParams.get("format")})`, ipAddress: ctx.ip } });
    switch (u.searchParams.get("format")) {
      case "csv":
        return fileResponse(toCsv(table), `${name}.csv`, MIME.csv);
      case "pdf":
        return fileResponse(await toPdf(table), `${name}.pdf`, MIME.pdf, true);
      default:
        return fileResponse(await toXlsx(table), `${name}.xlsx`, MIME.xlsx);
    }
  } catch (e) {
    const r = toActionError(e);
    return NextResponse.json({ error: r.error }, { status: e instanceof PermissionError ? 403 : 400 });
  }
}
