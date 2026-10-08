import fs from "node:fs";
import ExcelJS from "exceljs";
import JSZip from "jszip";
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

/**
 * Sheet number (xl/worksheets/sheetN.xml) -> sheet name, read from the workbook index.
 * The streaming reader cannot always name a sheet itself, because writers may store workbook.xml after the sheets.
 */
async function workbookIndex(filePath: string): Promise<{ names: Map<number, string>; strings: string[] }> {
  const zip = await JSZip.loadAsync(await fs.promises.readFile(filePath));
  const wbXml = (await zip.file("xl/workbook.xml")?.async("string")) ?? "";
  const relXml = (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";
  const rels = new Map<string, string>();
  for (const m of relXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = m[0].match(/\bId="([^"]+)"/)?.[1];
    const target = m[0].match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) rels.set(id, target);
  }
  const out = new Map<number, string>();
  const unescape = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = m[0].match(/\bname="([^"]+)"/)?.[1];
    const rid = m[0].match(/\br:id="([^"]+)"/)?.[1];
    const n = rid ? rels.get(rid)?.match(/sheet(\d+)\.xml$/)?.[1] : undefined;
    if (name && n) out.set(Number(n), unescape(name));
  }
  // shared strings: the streaming reader returns { sharedString: n } when they are stored after the sheets (Excel does this)
  const ssXml = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
  const strings: string[] = [];
  for (const si of ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const text = [...si[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("");
    strings.push(unescape(text).replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))));
  }
  return { names: out, strings };
}

/** Read an ERP backup / import workbook into canonical strings. Never touches the database. */
export async function readBackupWorkbook(filePath: string): Promise<ParsedBackup> {
  const { names, strings } = await workbookIndex(filePath);
  const rowValues = (row: ExcelJS.Row): any[] => {
    const v = row.values as any[];
    if (!Array.isArray(v)) return [];
    return v.slice(1).map((x) => (x && typeof x === "object" && "sharedString" in x ? strings[x.sharedString] ?? null : cellPrimitive(x)));
  };
  const byName = new Map(SHEETS.map((d) => [norm(d.name), d]));
  // also accept the sheet label without its number prefix ("Customers"), for hand-made import files
  for (const d of SHEETS) byName.set(norm(d.name.replace(/^\d+_/, "")), d);

  const out: ParsedBackup = {
    hasInfo: false, info: {}, sheetInfo: {}, financials: {}, unknownSheets: [],
    sheets: Object.fromEntries(SHEETS.map((def) => [def.key, { def, present: false, missingColumns: [], missingRequiredColumns: [], unknownColumns: [], rows: [] }])) as any,
    computedChecksum: "", computedSheetHashes: {},
  };

  const reader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, { worksheets: "emit", sharedStrings: "cache", hyperlinks: "ignore", styles: "cache", entries: "emit" } as any);
  for await (const ws of reader as any) {
    const wsName: string = names.get(Number(ws.id)) ?? ws.name;
    if (wsName === INFO_SHEET) {
      out.hasInfo = true;
      let section: "fields" | "sheets" | "fin" | "other" = "fields";
      const labelToKey = new Map(Object.entries(FINANCIAL_LABELS).map(([k, l]) => [l, k]));
      for await (const row of ws) {
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
    const def = byName.get(norm(wsName));
    if (!def) { out.unknownSheets.push(wsName); for await (const _ of ws) { /* drain */ } continue; }
    const ps = out.sheets[def.key];
    ps.present = true;
    let colIndex: number[] = []; // def column -> file column index (or -1)
    for await (const row of ws) {
      const vals = rowValues(row);
      if (row.number === 1) {
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
