import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { ReportResult } from "../services/reports.js";
import { displayDate } from "../../shared/calc.js";

const fmtMoney = (n: any) => (n === null || n === undefined || n === "" ? "" : Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export async function reportXlsx(r: ReportResult, company: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "G Road Lines ERP";
  const ws = wb.addWorksheet(r.title.replace(/[*?:\\/\[\]]/g, "-").slice(0, 31), { views: [{ state: "frozen", ySplit: 4 }] });
  ws.addRow([company]).font = { bold: true, size: 14 };
  ws.addRow([r.title]).font = { bold: true, size: 12 };
  ws.addRow([r.subtitle]);
  const h = ws.addRow(r.columns.map((c) => c.header));
  h.font = { bold: true, color: { argb: "FFFFFFFF" } };
  h.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } }; });
  r.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width ?? Math.max(12, c.header.length + 2);
    if (c.kind === "money") col.numFmt = "#,##0.00";
    if (c.kind === "pct") col.numFmt = "0.00";
    if (c.kind === "date") col.numFmt = "dd-mm-yyyy";
  });
  for (const row of r.rows) {
    ws.addRow(r.columns.map((c) => {
      const v = row[c.key];
      if (v === null || v === undefined) return null;
      if (c.kind === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T00:00:00Z`);
      return v;
    }));
  }
  if (r.totals) ws.addRow(r.columns.map((c) => r.totals![c.key] ?? null)).font = { bold: true };
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + r.rows.length, column: r.columns.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** CSV with spreadsheet-formula neutralisation (a cell starting with = + - @ is prefixed with '). */
export function reportCsv(r: ReportResult): string {
  const esc = (v: any) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [r.columns.map((c) => esc(c.header)).join(",")];
  for (const row of r.rows) lines.push(r.columns.map((c) => esc(row[c.key])).join(","));
  if (r.totals) lines.push(r.columns.map((c) => esc(r.totals![c.key])).join(","));
  return "﻿" + lines.join("\r\n");
}

export function reportPdf(r: ReportResult, company: string): Promise<Buffer> {
  return new Promise((resolve) => {
    const landscape = r.columns.length > 6;
    const doc = new PDFDocument({ size: "A4", layout: landscape ? "landscape" : "portrait", margin: 28 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    const width = doc.page.width - 56;
    const weights = r.columns.map((c) => (c.width ?? 12));
    const totalW = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (w / totalW) * width);
    const header = () => {
      doc.font("Helvetica-Bold").fontSize(13).text(company, 28, 28);
      doc.fontSize(11).text(r.title);
      doc.font("Helvetica").fontSize(8).fillColor("#555").text(`${r.subtitle}   ·   Printed ${new Date().toLocaleString("en-IN")}`).fillColor("#000");
      doc.moveDown(0.5);
      drawRow(r.columns.map((c) => c.header), true);
    };
    const cell = (c: (typeof r.columns)[number], v: any) => {
      if (v === null || v === undefined) return "";
      if (c.kind === "money") return fmtMoney(v);
      if (c.kind === "pct") return `${Number(v).toFixed(2)}%`;
      if (c.kind === "date") return displayDate(String(v));
      return String(v);
    };
    const drawRow = (vals: string[], bold = false) => {
      const y = doc.y;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(7.5);
      let h = 0;
      vals.forEach((v, i) => { h = Math.max(h, doc.heightOfString(v, { width: widths[i] - 4 })); });
      if (y + h + 6 > doc.page.height - 30) { doc.addPage(); header(); return drawRow(vals, bold); }
      let x = 28;
      vals.forEach((v, i) => {
        const right = !bold && ["money", "int", "num", "pct"].includes(r.columns[i].kind);
        doc.text(v, x + 2, y + 2, { width: widths[i] - 4, align: right ? "right" : "left" });
        x += widths[i];
      });
      doc.moveTo(28, y + h + 4).lineTo(28 + width, y + h + 4).strokeColor("#ccc").lineWidth(0.5).stroke();
      doc.y = y + h + 5;
      doc.x = 28;
    };
    header();
    for (const row of r.rows) drawRow(r.columns.map((c) => cell(c, row[c.key])));
    if (r.totals) drawRow(r.columns.map((c) => cell(c, r.totals![c.key])), true);
    doc.end();
  });
}
