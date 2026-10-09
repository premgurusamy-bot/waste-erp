/**
 * Reads a client's file in whatever shape it comes: Excel (.xlsx / .xlsm), CSV, TSV, TXT (any delimiter),
 * or JSON. Returns plain tables (header + rows). Title rows above the header are skipped automatically.
 */
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { cellPrimitive } from "../backup/canonical.js";

export type Table = { name: string; headerRow: number; headers: string[]; rows: { rowNumber: number; values: any[] }[] };
export const IMPORT_EXTENSIONS = [".xlsx", ".xlsm", ".csv", ".tsv", ".txt", ".json"];

const blank = (v: any) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** Header = first row (within the first 15) with at least two text cells and mostly non-empty. */
function findHeader(rows: any[][]): number {
  let best = 0, bestScore = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const r = rows[i] ?? [];
    const filled = r.filter((v) => !blank(v));
    const texts = filled.filter((v) => typeof v === "string" && !/^[\d.,\s₹-]+$/.test(v));
    if (texts.length < 2) continue;
    const score = texts.length * 2 + filled.length;
    if (score > bestScore) { bestScore = score; best = i; }
    if (texts.length >= 3 && texts.length === filled.length) return i;
  }
  return best;
}

function toTable(name: string, grid: any[][], rowNumbers?: number[]): Table {
  const h = findHeader(grid);
  const rawHeaders = (grid[h] ?? []).map((v) => (blank(v) ? "" : String(v instanceof Date ? v.toISOString().slice(0, 10) : v).trim()));
  const width = Math.max(rawHeaders.length, ...grid.slice(h + 1).map((r) => r.length));
  const seen = new Map<string, number>();
  const headers = Array.from({ length: width }, (_, i) => {
    let base = rawHeaders[i] || `Column ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    if (n > 1) base = `${base} (${n})`;
    return base;
  });
  const rows = grid.slice(h + 1).map((values, i) => ({ rowNumber: rowNumbers ? rowNumbers[h + 1 + i] : h + 2 + i, values }))
    .filter((r) => r.values.some((v) => !blank(v)));
  return { name, headerRow: rowNumbers ? rowNumbers[h] : h + 1, headers, rows };
}

// ---------------------------------------------------------------- delimited text
export function decodeText(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  const s = buf.toString("utf8");
  // invalid UTF-8 (old Excel "CSV" from Windows): fall back to Windows-1252 / Latin-1
  return (s.includes("�") ? buf.toString("latin1") : s).replace(/^﻿/, "");
}

export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let best = ",", bestScore = 0;
  for (const d of [",", ";", "\t", "|"]) {
    const counts = lines.map((l) => splitDelimited(l, d)[0]?.length ?? 1);
    const common = counts.sort((a, b) => counts.filter((x) => x === b).length - counts.filter((x) => x === a).length)[0] ?? 1;
    const score = common > 1 ? common * counts.filter((c) => c === common).length : 0;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

/** RFC 4180 parser: quoted fields, doubled quotes, delimiters and new lines inside quotes. */
export function splitDelimited(text: string, d: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"' && field === "") inQ = true;
    else if (c === d) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); out.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); out.push(row); }
  return out.map((r) => r.map((v) => v.trim()));
}

// ---------------------------------------------------------------- JSON
function flatten(o: any, prefix = "", out: Record<string, any> = {}) {
  for (const [k, v] of Object.entries(o ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}
function jsonTables(data: any): Table[] {
  const arrays: [string, any[]][] = [];
  if (Array.isArray(data)) arrays.push(["Data", data]);
  else if (data && typeof data === "object") for (const [k, v] of Object.entries(data)) if (Array.isArray(v) && v.some((x) => x && typeof x === "object")) arrays.push([k, v]);
  return arrays.map(([name, arr]) => {
    const objs = arr.filter((x) => x && typeof x === "object").map((x) => flatten(x));
    const headers = [...new Set(objs.flatMap((o) => Object.keys(o)))];
    return { name, headerRow: 1, headers, rows: objs.map((o, i) => ({ rowNumber: i + 2, values: headers.map((h) => o[h] ?? null) })) };
  });
}

// ---------------------------------------------------------------- entry point
export async function readAnyFile(filePath: string, originalName: string): Promise<Table[]> {
  const ext = path.extname(originalName).toLowerCase();
  if ([".xls", ".ods", ".xlsb", ".numbers"].includes(ext)) throw new Error(`${ext} files cannot be read directly. Open the file in Excel / LibreOffice and use "Save As" → Excel Workbook (.xlsx) or CSV, then import that.`);
  if (ext === ".pdf" || [".jpg", ".jpeg", ".png"].includes(ext)) throw new Error("PDF and image files cannot be imported as data. Export the data to Excel or CSV from the program that made it.");
  if (!IMPORT_EXTENSIONS.includes(ext)) throw new Error(`Unsupported file type ${ext || "(none)"}. Use Excel (.xlsx), CSV, TSV, TXT or JSON.`);
  if (ext === ".xlsx" || ext === ".xlsm") {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const tables: Table[] = [];
    for (const ws of wb.worksheets) {
      const grid: any[][] = [], nums: number[] = [];
      ws.eachRow({ includeEmpty: false }, (r) => {
        grid.push((Array.isArray(r.values) ? (r.values as any[]).slice(1) : []).map(cellPrimitive));
        nums.push(r.number);
      });
      if (grid.length) tables.push(toTable(ws.name, grid, nums));
    }
    return tables;
  }
  const text = decodeText(fs.readFileSync(filePath));
  if (ext === ".json") {
    let data: any;
    try { data = JSON.parse(text); } catch { throw new Error("The JSON file is not valid."); }
    const t = jsonTables(data);
    if (!t.length) throw new Error("No list of records found in the JSON file.");
    return t;
  }
  const d = ext === ".tsv" ? "\t" : detectDelimiter(text);
  return [toTable(path.basename(originalName), splitDelimited(text, d))];
}
