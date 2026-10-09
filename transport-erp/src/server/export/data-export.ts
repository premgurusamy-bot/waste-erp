/**
 * Export any ERP table (or everything) in the format the user needs:
 * Excel (.xlsx), CSV, TSV, JSON, XML, PDF, HTML (printable), or straight into Google Sheets.
 * Names (customer, vehicle...) and calculated columns (profit, balance) are included next to the IDs.
 */
import ExcelJS from "exceljs";
import { SHEETS, SHEET_BY_KEY, type SheetKey, type Col } from "../backup/sheets.js";
import { loadAll, buildLookups, canonicalRows } from "../backup/excel-export.js";
import { excelValue } from "../backup/canonical.js";
import { reportCsv, reportPdf } from "../lib/export.js";
import type { ReportCol, ReportResult } from "../services/reports.js";

export const EXPORT_FORMATS = ["xlsx", "csv", "tsv", "json", "xml", "pdf", "html"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const MIME: Record<ExportFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv; charset=utf-8", tsv: "text/tab-separated-values; charset=utf-8",
  json: "application/json; charset=utf-8", xml: "application/xml; charset=utf-8", pdf: "application/pdf", html: "text/html; charset=utf-8",
};

const DATE_FIELD: Partial<Record<SheetKey, string>> = {
  trips: "tripDate", expenses: "expenseDate", invoices: "invoiceDate", receipts: "receiptDate", payments: "paymentDate", auditLogs: "at", targets: "startDate",
};

export function datasets() {
  return SHEETS.map((s) => ({ key: s.key, name: s.name, label: s.label, dateFilter: !!DATE_FIELD[s.key] }));
}

type Rows = { def: (typeof SHEETS)[number]; cols: Col[]; rows: string[][] };

async function collect(keys: SheetKey[], from?: string, to?: string): Promise<Rows[]> {
  const data = await loadAll();
  const l = buildLookups(data);
  return keys.map((k) => {
    const def = SHEET_BY_KEY[k];
    let src = data[k] as any[];
    const df = DATE_FIELD[k];
    if (df && (from || to)) src = src.filter((r) => { const d = String(r[df] ?? "").slice(0, 10); return (!from || d >= from) && (!to || d <= to); });
    return { def, cols: def.columns, rows: canonicalRows(def, src, l) };
  });
}

const kindOf = (c: Col): ReportCol["kind"] => (c.type === "money" ? "money" : c.type === "int" ? "int" : ["qty", "km", "pct"].includes(c.type) ? "num" : c.type === "date" ? "date" : "string");
const typed = (c: Col, v: string) => (v === "" ? null : ["money", "qty", "km", "pct", "int"].includes(c.type) ? Number(v) : c.type === "json" ? JSON.parse(v) : c.type === "bool" ? v === "TRUE" : v);
const xmlEsc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
const htmlEsc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
/** PDF / HTML are for reading: leave out long technical columns (UUIDs, JSON, timestamps). */
const readable = (c: Col) => !(c.type === "id" || c.type === "json" || c.type === "datetime" || ["sha256", "storedName", "entityId", "device", "userId"].includes(c.key));

export async function exportData(key: SheetKey | "all", format: ExportFormat, opts: { from?: string; to?: string; company?: string } = {}): Promise<{ body: Buffer; mime: string; fileName: string }> {
  const keys = key === "all" ? SHEETS.map((s) => s.key) : [key];
  if (key !== "all" && !SHEET_BY_KEY[key]) throw new Error("Unknown data set.");
  const sets = await collect(keys, opts.from, opts.to);
  const day = new Date().toISOString().slice(0, 10);
  const base = key === "all" ? `GRL_ERP_ALL_DATA_${day}` : `GRL_${SHEET_BY_KEY[key].label.replace(/\W+/g, "_")}_${day}`;
  const company = opts.company ?? "G Road Lines";

  if (format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    for (const s of sets) {
      const ws = wb.addWorksheet(s.def.name, { views: [{ state: "frozen", ySplit: 1 }] });
      ws.columns = s.cols.map((c) => ({ header: c.header, key: c.key, width: c.width ?? Math.max(12, c.header.length + 2), style: c.type === "money" ? { numFmt: "#,##0.00" } : c.type === "date" ? { numFmt: "dd-mm-yyyy" } : {} }));
      ws.getRow(1).font = { bold: true };
      for (const r of s.rows) ws.addRow(s.cols.map((c, i) => excelValue(c.type, r[i])));
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, s.rows.length + 1), column: s.cols.length } };
    }
    return { body: Buffer.from(await wb.xlsx.writeBuffer()), mime: MIME.xlsx, fileName: `${base}.xlsx` };
  }
  if (format === "json") {
    const obj = Object.fromEntries(sets.map((s) => [s.def.key, s.rows.map((r) => Object.fromEntries(s.cols.map((c, i) => [c.key, typed(c, r[i])])))]));
    const payload = key === "all" ? { exportedAt: new Date().toISOString(), company, ...obj } : obj[key];
    return { body: Buffer.from(JSON.stringify(payload, null, 2)), mime: MIME.json, fileName: `${base}.json` };
  }
  if (format === "xml") {
    const parts = ['<?xml version="1.0" encoding="UTF-8"?>', `<grlErp exportedAt="${new Date().toISOString()}" company="${xmlEsc(company)}">`];
    for (const s of sets) {
      parts.push(`  <${s.def.key}>`);
      for (const r of s.rows) parts.push(`    <record>${s.cols.map((c, i) => (r[i] === "" ? "" : `<${c.key}>${xmlEsc(r[i])}</${c.key}>`)).join("")}</record>`);
      parts.push(`  </${s.def.key}>`);
    }
    parts.push("</grlErp>");
    return { body: Buffer.from(parts.join("\n")), mime: MIME.xml, fileName: `${base}.xml` };
  }
  if (key === "all") throw new Error("For all data at once use Excel, JSON or XML (or EXPORT ALL DATA on the Backup page).");
  const s = sets[0];
  if (format === "csv" || format === "tsv") {
    const r: ReportResult = { title: s.def.label, subtitle: "", columns: s.cols.map((c) => ({ key: c.key, header: c.header, kind: "string" })), rows: s.rows.map((row) => Object.fromEntries(s.cols.map((c, i) => [c.key, row[i]]))) };
    let text = reportCsv(r);
    if (format === "tsv") text = "﻿" + s.rows.reduce((acc, row) => acc + "\r\n" + row.map((v) => { const x = v.replace(/[\t\r\n]/g, " "); return /^[=+\-@]/.test(x) && !/^-?\d+(\.\d+)?$/.test(x) ? `'${x}` : x; }).join("\t"), s.cols.map((c) => c.header).join("\t"));
    return { body: Buffer.from(text), mime: MIME[format], fileName: `${base}.${format}` };
  }
  const cols = s.cols.filter(readable);
  const idx = cols.map((c) => s.cols.indexOf(c));
  if (format === "pdf") {
    const r: ReportResult = {
      title: s.def.label, subtitle: `${s.rows.length} record(s)${opts.from || opts.to ? ` · ${opts.from ?? "…"} to ${opts.to ?? "…"}` : ""}`,
      columns: cols.map((c) => ({ key: c.key, header: c.header, kind: kindOf(c), width: Math.min(c.width ?? 12, 24) })),
      rows: s.rows.map((row) => Object.fromEntries(cols.map((c, j) => [c.key, typed(c, row[idx[j]])]))),
    };
    return { body: await reportPdf(r, company), mime: MIME.pdf, fileName: `${base}.pdf` };
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEsc(s.def.label)}</title><style>body{font-family:Segoe UI,Arial;font-size:12px;margin:20px}table{border-collapse:collapse}th,td{border:1px solid #ccc;padding:4px 6px;text-align:left}th{background:#1f3a5f;color:#fff}td.n{text-align:right}</style></head><body><h2>${htmlEsc(company)} – ${htmlEsc(s.def.label)}</h2><p>${s.rows.length} record(s) · exported ${new Date().toLocaleString("en-IN")}</p><table><thead><tr>${cols.map((c) => `<th>${htmlEsc(c.header)}</th>`).join("")}</tr></thead><tbody>${s.rows.map((row) => `<tr>${cols.map((c, j) => `<td${["money", "int", "qty", "km"].includes(c.type) ? ' class="n"' : ""}>${htmlEsc(row[idx[j]])}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`;
  return { body: Buffer.from(html), mime: MIME.html, fileName: `${base}.html` };
}
