import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime, num } from "@/lib/utils";
import type { ColType, ReportColumn, Row } from "./reports";

export type Table = { title: string; subtitle?: string; columns: ReportColumn[]; rows: Row[]; totals?: Row };

const fmtNum = (v: number, dp: number) => num(v).toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });

export function formatCell(v: unknown, type?: ColType): string {
  if (v === null || v === undefined || v === "") return "";
  switch (type) {
    case "money": return fmtNum(v as number, 2);
    case "qty": return num(v as number).toLocaleString("en-IN", { maximumFractionDigits: 3 });
    case "int": return fmtNum(v as number, 0);
    case "pct": return `${fmtNum(v as number, 2)}%`;
    case "date": return formatDate(String(v));
    case "datetime": return formatDateTime(String(v));
    default: return String(v);
  }
}

export async function toXlsx(t: Table): Promise<Buffer> {
  const company = await prisma.company.findFirst();
  const wb = new ExcelJS.Workbook();
  wb.creator = "GreenCycle ERP";
  wb.created = new Date();
  const ws = wb.addWorksheet(t.title.slice(0, 31).replace(/[\\/*?:[\]]/g, " "));
  ws.addRow([company?.name ?? ""]).font = { bold: true, size: 12 };
  ws.addRow([t.title]).font = { bold: true, size: 14, color: { argb: "FF1B365D" } };
  if (t.subtitle) ws.addRow([t.subtitle]).font = { italic: true, color: { argb: "FF64748B" } };
  ws.addRow([]);
  const header = ws.addRow(t.columns.map((c) => c.label));
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B365D" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  for (const r of t.rows) {
    ws.addRow(
      t.columns.map((c) => {
        const v = r[c.key];
        if (v === null || v === undefined) return "";
        if (c.type === "date" && v) return new Date(String(v));
        if (c.type === "datetime" && v) return formatDateTime(String(v));
        if (["money", "qty", "int", "pct"].includes(c.type ?? "")) return num(v as number);
        return v;
      }),
    );
  }
  if (t.totals && Object.keys(t.totals).length) {
    const tr = ws.addRow(t.columns.map((c, i) => (i === 0 ? "TOTAL" : t.totals![c.key] ?? "")));
    tr.font = { bold: true };
    tr.eachCell((cell) => (cell.border = { top: { style: "thin" } }));
  }
  t.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.min(45, Math.max(c.label.length + 2, c.type === "date" ? 12 : c.type ? 14 : 22));
    if (c.type === "money") col.numFmt = "#,##,##0.00";
    if (c.type === "qty") col.numFmt = "#,##,##0.###";
    if (c.type === "date") col.numFmt = "dd-mm-yyyy";
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function toCsv(t: Table): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  // Prevent spreadsheet formula injection from user-entered text
  const safe = (s: string) => (/^[=+\-@]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s);
  const lines = [t.columns.map((c) => esc(c.label)).join(",")];
  for (const r of t.rows) {
    lines.push(t.columns.map((c) => {
      const v = r[c.key];
      if (v === null || v === undefined) return "";
      if (["money", "qty", "int", "pct"].includes(c.type ?? "")) return String(v);
      return esc(safe(formatCell(v, c.type)));
    }).join(","));
  }
  return "﻿" + lines.join("\n");
}

const NAVY = "#1b365d";
const GREEN = "#039855";

export function pdfBuffer(build: (doc: PDFKit.PDFDocument) => void, opts: PDFKit.PDFDocumentOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36, bufferPages: true, ...opts });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    build(doc);
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.height - 24;
      const prev = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.fontSize(7).fillColor("#94a3b8").text(`Generated ${formatDateTime(new Date())} · Page ${i + 1} of ${range.count}`, 36, bottom, { width: doc.page.width - 72, align: "right" });
      doc.page.margins.bottom = prev;
    }
    doc.end();
  });
}

export async function companyHeader(doc: PDFKit.PDFDocument, title: string, subtitle?: string) {
  const c = await prisma.company.findFirst();
  const w = doc.page.width - 72;
  doc.rect(36, 30, w, 3).fill(GREEN);
  doc.fillColor(NAVY).fontSize(14).font("Helvetica-Bold").text(c?.name ?? "", 36, 42, { width: w * 0.6 });
  doc.font("Helvetica").fontSize(8).fillColor("#475569")
    .text([c?.address, c?.city, c?.pincode].filter(Boolean).join(", "), { width: w * 0.6 })
    .text([c?.gstin ? `GSTIN: ${c.gstin}` : "", c?.phone, c?.email].filter(Boolean).join("  ·  "), { width: w * 0.6 });
  doc.font("Helvetica-Bold").fontSize(13).fillColor(NAVY).text(title, 36 + w * 0.55, 42, { width: w * 0.45, align: "right" });
  if (subtitle) doc.font("Helvetica").fontSize(8).fillColor("#475569").text(subtitle, 36 + w * 0.45, doc.y + 2, { width: w * 0.55, align: "right" });
  doc.moveDown(1);
  doc.y = Math.max(doc.y, 92);
  doc.moveTo(36, doc.y).lineTo(36 + w, doc.y).lineWidth(0.5).strokeColor("#cbd5e1").stroke();
  doc.y += 8;
  return c;
}

/** Generic tabular PDF used by every report export. */
export async function toPdf(t: Table): Promise<Buffer> {
  const landscape = t.columns.length > 7;
  const company = await prisma.company.findFirst();
  return pdfBuffer(
    (doc) => {
      const w = doc.page.width - 72;
      const header = () => {
        doc.rect(36, 30, w, 3).fill(GREEN);
        doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(12).text(company?.name ?? "", 36, 40);
        doc.fontSize(11).text(t.title, 36, 40, { width: w, align: "right" });
        if (t.subtitle) doc.font("Helvetica").fontSize(8).fillColor("#475569").text(t.subtitle, 36, 56, { width: w, align: "right" });
        doc.y = 74;
      };
      header();
      const weights = t.columns.map((c) => (c.type === "date" ? 1 : c.type === "datetime" ? 1.4 : c.type ? 1 : 1.8));
      const sum = weights.reduce((a, b) => a + b, 0);
      const widths = weights.map((x) => (x / sum) * w);
      const right = (c: ReportColumn) => ["money", "qty", "int", "pct"].includes(c.type ?? "");
      const drawRow = (cells: string[], opts: { bold?: boolean; fill?: string; color?: string }) => {
        doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(7.5);
        const h = Math.max(...cells.map((s, i) => doc.heightOfString(s, { width: widths[i] - 6 }))) + 6;
        if (doc.y + h > doc.page.height - 40) {
          doc.addPage();
          header();
          drawRow(t.columns.map((c) => c.label), { bold: true, fill: NAVY, color: "#ffffff" });
        }
        const y = doc.y;
        if (opts.fill) doc.rect(36, y, w, h).fill(opts.fill);
        let x = 36;
        cells.forEach((s, i) => {
          doc.fillColor(opts.color ?? "#1e293b").text(s, x + 3, y + 3, { width: widths[i] - 6, align: right(t.columns[i]) ? "right" : "left" });
          x += widths[i];
        });
        doc.y = y + h;
        doc.moveTo(36, doc.y).lineTo(36 + w, doc.y).lineWidth(0.3).strokeColor("#e2e8f0").stroke();
      };
      drawRow(t.columns.map((c) => c.label), { bold: true, fill: NAVY, color: "#ffffff" });
      t.rows.forEach((r, idx) => drawRow(t.columns.map((c) => formatCell(r[c.key], c.type)), { fill: idx % 2 ? "#f8fafc" : undefined }));
      if (t.rows.length === 0) doc.font("Helvetica").fontSize(9).fillColor("#64748b").text("No records for the selected filters.", 36, doc.y + 8);
      if (t.totals && Object.keys(t.totals).length && t.rows.length) {
        drawRow(t.columns.map((c, i) => (i === 0 ? "TOTAL" : t.totals![c.key] !== undefined ? formatCell(t.totals![c.key], c.type) : "")), { bold: true, fill: "#ecfdf3" });
      }
    },
    { layout: landscape ? "landscape" : "portrait" },
  );
}

export function fileResponse(body: Buffer | string, filename: string, type: string, inline = false) {
  return new Response(typeof body === "string" ? body : new Uint8Array(body), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename.replace(/[^\w.\-]/g, "_")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export const MIME = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
  pdf: "application/pdf",
};
