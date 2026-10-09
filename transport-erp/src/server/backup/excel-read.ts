import ExcelJS from "exceljs";
import { SHEETS, INFO_SHEET, type SheetDef, type SheetKey } from "./sheets.js";
import { canon, cellPrimitive, CellError, sheetHash, overallChecksum } from "./canonical.js";
import { FINANCIAL_LABELS } from "./financials.js";

export type RowIssue = { column: string; message: string };
export type ParsedRow = { rowNumber: number; cells: string[]; issues: RowIssue[] };
export type ParsedSheet = {
  def: SheetDef;
  present: boolean;
  missingColumns: string[];
  missingRequiredColumns: string[];
  unknownColumns: string[];
  rows: ParsedRow[];
};

export type ParsedBackup = {
  hasInfo: boolean;
  info: Record<string, string>;
  sheetInfo: Record<string, { count: number; hash: string }>;
  financials: Record<string, number>;
  sheets: Record<SheetKey, ParsedSheet>;
  unknownSheets: string[];
  computedChecksum: string;
  computedSheetHashes: Record<string, string>;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function rowValues(row: ExcelJS.Row): any[] {
  const v = row.values as any[];
  return Array.isArray(v) ? v.slice(1).map(cellPrimitive) : [];
}

function rowsOf(ws: ExcelJS.Worksheet): ExcelJS.Row[] {
  const out: ExcelJS.Row[] = [];
  ws.eachRow({ includeEmpty: false }, (r) => { out.push(r); });
  return out;
}

/**
 * Read an ERP backup / import workbook into canonical strings. Never touches the database.
 * Uses the in-memory reader on purpose: the streaming reader of ExcelJS can silently skip sheets,
 * which is unacceptable for a restore.
 */
export async function readBackupWorkbook(filePath: string): Promise<ParsedBackup> {
  const byName = new Map(SHEETS.map((d) => [norm(d.name), d]));
  // also accept the sheet label without its number prefix ("Customers"), for hand-made import files
  for (const d of SHEETS) byName.set(norm(d.name.replace(/^\d+_/, "")), d);

  const out: ParsedBackup = {
    hasInfo: false, info: {}, sheetInfo: {}, financials: {}, unknownSheets: [],
    sheets: Object.fromEntries(SHEETS.map((def) => [def.key, { def, present: false, missingColumns: [], missingRequiredColumns: [], unknownColumns: [], rows: [] }])) as any,
    computedChecksum: "", computedSheetHashes: {},
  };

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  for (const ws of wb.worksheets) {
    if (ws.name === INFO_SHEET) {
      out.hasInfo = true;
      let section: "fields" | "sheets" | "fin" | "other" = "fields";
      const labelToKey = new Map(Object.entries(FINANCIAL_LABELS).map(([k, l]) => [l, k]));
      for (const row of rowsOf(ws)) {
        if (row.number === 1) continue;
        const [a, b, c] = rowValues(row);
        const A = a === null || a === undefined ? "" : String(a).trim();
        if (!A) continue;
        if (A === "Sheet") { section = "sheets"; continue; }
        if (A === "Financial Total") { section = "fin"; continue; }
        if (A === "Notes") { section = "other"; continue; }
        if (section === "fields") out.info[A] = b === null || b === undefined ? "" : b instanceof Date ? b.toISOString() : String(b);
        else if (section === "sheets") out.sheetInfo[A] = { count: Number(b), hash: String(c ?? "") };
        else if (section === "fin") { const k = labelToKey.get(A); if (k) out.financials[k] = Number(b); }
      }
      continue;
    }
    const def = byName.get(norm(ws.name));
    if (!def) { out.unknownSheets.push(ws.name); continue; }
    const ps = out.sheets[def.key];
    ps.present = true;
    let colIndex: number[] = def.columns.map(() => -1); // def column -> file column index (or -1)
    let headerSeen = false;
    for (const row of rowsOf(ws)) {
      const vals = rowValues(row);
      if (!headerSeen) {
        headerSeen = true;
        const headers = vals.map((h) => norm(String(h ?? "")));
        colIndex = def.columns.map((c) => {
          let i = headers.indexOf(norm(c.header));
          if (i < 0) i = headers.indexOf(norm(c.key));
          return i;
        });
        def.columns.forEach((c, i) => {
          if (colIndex[i] < 0) {
            ps.missingColumns.push(c.header);
            if (c.required) ps.missingRequiredColumns.push(c.header);
          }
        });
        const known = new Set(def.columns.flatMap((c) => [norm(c.header), norm(c.key)]));
        ps.unknownColumns = vals.map((h) => String(h ?? "")).filter((h) => h && !known.has(norm(h)));
        continue;
      }
      if (vals.every((v) => v === null || v === undefined || v === "")) continue;
      if (String(vals[0] ?? "").trim() === "TOTAL") continue;
      const issues: RowIssue[] = [];
      const cells = def.columns.map((c, i) => {
        if (colIndex[i] < 0) return "";
        try {
          return canon(c.type, vals[colIndex[i]]);
        } catch (e) {
          if (!c.derived) issues.push({ column: c.header, message: e instanceof CellError ? `${c.header} ${e.message}` : String(e) });
          return "";
        }
      });
      ps.rows.push({ rowNumber: row.number, cells, issues });
    }
    if (!headerSeen) def.columns.forEach((c) => { ps.missingColumns.push(c.header); if (c.required) ps.missingRequiredColumns.push(c.header); });
  }

  const parts = SHEETS.map((def) => {
    const rows = out.sheets[def.key].rows.map((r) => r.cells);
    const hash = sheetHash(def, rows);
    out.computedSheetHashes[def.name] = hash;
    return { name: def.name, count: rows.length, hash };
  });
  out.computedChecksum = overallChecksum(parts, Object.fromEntries(Object.keys(FINANCIAL_LABELS).map((k) => [k, out.financials[k] ?? 0])));
  return out;
}

/** Turn a parsed row into an object keyed by field name (canonical strings). */
export function rowObject(def: SheetDef, cells: string[]): Record<string, string> {
  const o: Record<string, string> = {};
  def.columns.forEach((c, i) => { o[c.key] = cells[i]; });
  return o;
}
