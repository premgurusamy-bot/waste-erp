/**
 * Turns a client's own file (any layout) into ERP records:
 *   1. the user maps each column to an ERP field (suggested automatically),
 *   2. names are resolved to existing records (customer "ABC Mfg" -> its ID), missing masters can be created,
 *   3. rows that match an existing record update it (unmapped fields keep their current values),
 *   4. the result is written as an ERP import workbook and goes through the normal restore engine:
 *      validation, preview, automatic safety backup, one transaction, verification, rollback.
 * Row numbers in the generated workbook are the row numbers of the client's file, so every error points at the right row.
 */
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { SHEET_BY_KEY, type SheetKey } from "../backup/sheets.js";
import { loadAll } from "../backup/excel-export.js";
import { readAnyFile } from "./parse.js";
import { importFields, REF_LOOKUP, DEFAULTS, cleanValue, IMPORT_TARGETS, type ImportField } from "./targets.js";
import { stageUpload } from "../backup/restore-service.js";
import { stamp } from "../lib/util.js";

export type PrepareInput = {
  filePath: string; fileName: string; tableIndex: number; target: SheetKey;
  mapping: Record<string, string>; // column index -> field key
  createMissing: boolean; existing: "update" | "skip"; defaults?: Record<string, string>;
};
export type Problem = { row: number; field: string; value: string; error: string };

const CREATABLE: SheetKey[] = ["customers", "transporters", "vehicles", "drivers", "loadingPoints", "deliveryPoints"];
const norm = (v: any) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const plate = (v: any) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Which existing field identifies "the same record" when importing into each sheet. */
const MATCH: Partial<Record<SheetKey, string[]>> = {
  customers: ["code", "gstin", "name"], transporters: ["code", "gstin", "name"], vehicles: ["code", "vehicleNumber"], drivers: ["code", "licenseNumber", "name"],
  loadingPoints: ["code", "name"], deliveryPoints: ["code", "name"], freight: ["code"], trips: ["tripNumber"], expenses: ["code"], receipts: ["code"], payments: ["code"],
};

export async function prepareImport(input: PrepareInput) {
  if (!IMPORT_TARGETS.some((t) => t.key === input.target)) throw new Error("Choose what the file contains.");
  const tables = await readAnyFile(input.filePath, input.fileName);
  const table = tables[input.tableIndex];
  if (!table) throw new Error("Sheet not found in the file.");
  const fields = importFields(input.target);
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const colFor = new Map<string, number>();
  for (const [col, key] of Object.entries(input.mapping)) {
    if (!key) continue;
    if (!byKey.has(key)) throw new Error(`Unknown field ${key}.`);
    if (colFor.has(key)) throw new Error(`"${byKey.get(key)!.label}" is mapped to two columns.`);
    colFor.set(key, Number(col));
  }
  const unmappedRequired = fields.filter((f) => f.required && !colFor.has(f.key));
  if (unmappedRequired.length) throw new Error(`Map a column to: ${unmappedRequired.map((f) => f.label).join(", ")}`);

  const db = await loadAll();
  // index existing records for name -> id lookups
  const index = new Map<SheetKey, Map<string, Set<string>>>();
  const indexOf = (sheet: SheetKey) => {
    if (index.has(sheet)) return index.get(sheet)!;
    const m = new Map<string, Set<string>>();
    const keys = REF_LOOKUP[sheet]?.keys ?? ["code"];
    for (const r of db[sheet] as any[]) for (const k of keys) {
      const v = sheet === "vehicles" && k === "vehicleNumber" ? plate(r[k]) : norm(r[k]);
      if (!v) continue;
      if (!m.has(v)) m.set(v, new Set());
      m.get(v)!.add(r.id);
    }
    index.set(sheet, m);
    return m;
  };
  const created = new Map<SheetKey, Map<string, any>>();
  const problems: Problem[] = [];

  const resolve = (sheet: SheetKey, raw: any, row: number, field: ImportField): string | null => {
    const value = String(raw).trim();
    const k = sheet === "vehicles" ? plate(value) : norm(value);
    if (!k) return null;
    if (/^[0-9a-f-]{36}$/i.test(value) && (db[sheet] as any[]).some((r) => r.id === value)) return value;
    const hits = indexOf(sheet).get(k);
    if (hits?.size === 1) return [...hits][0];
    if (hits && hits.size > 1) {
      problems.push({ row, field: field.label, value, error: `${hits.size} existing ${SHEET_BY_KEY[sheet].label.toLowerCase()} match "${value}"` });
      return value;
    }
    const made = created.get(sheet)?.get(k);
    if (made) return made.id;
    if (input.createMissing && CREATABLE.includes(sheet)) {
      const nameField = REF_LOOKUP[sheet]!.nameField;
      const rec: any = { id: randomUUID(), [nameField]: sheet === "vehicles" ? plate(value) : value, ...(DEFAULTS[sheet] ?? {}) };
      if (!created.has(sheet)) created.set(sheet, new Map());
      created.get(sheet)!.set(k, rec);
      return rec.id;
    }
    return value; // not found: the restore engine reports "references missing ..." for this row
  };

  const targetDef = SHEET_BY_KEY[input.target];
  const existingRows = db[input.target] as any[];
  const matchFields = MATCH[input.target] ?? [];
  const out: { rowNumber: number; rec: any }[] = [];
  let matched = 0, skipped = 0;
  const seenNew = new Map<string, string>();

  for (const r of table.rows) {
    const rec: any = {};
    for (const [key, col] of colFor) {
      const f = byKey.get(key)!;
      const v = cleanValue(input.target, f, r.values[col]);
      if (v === null) continue;
      rec[key] = f.ref ? resolve(f.ref, v, r.rowNumber, f) : v;
    }
    if (!Object.keys(rec).length) continue;
    // same record already in the ERP?
    let existing: any = null, matchedOn = "";
    for (const mf of matchFields) {
      const v = rec[mf];
      if (v === undefined || v === null || v === "") continue;
      const want = mf === "vehicleNumber" ? plate(v) : norm(v);
      const hits = existingRows.filter((e) => (mf === "vehicleNumber" ? plate(e[mf]) : norm(e[mf])) === want);
      if (hits.length === 1) { existing = hits[0]; matchedOn = mf; break; }
      if (hits.length > 1) { problems.push({ row: r.rowNumber, field: mf, value: String(v), error: `${hits.length} existing records have this ${mf}; it was imported as a new record` }); break; }
    }
    if (existing) {
      matched++;
      if (input.existing === "skip") { skipped++; continue; }
      // keep the existing spelling of the value it was matched on ("ABC MANUFACTURING" does not rename "ABC Manufacturing")
      out.push({ rowNumber: r.rowNumber, rec: { ...existing, ...rec, [matchedOn]: existing[matchedOn], id: existing.id } });
      continue;
    }
    // created masters that this file also lists (e.g. a customer list): merge instead of duplicating
    const nameField = REF_LOOKUP[input.target]?.nameField;
    const nk = nameField && rec[nameField] ? (input.target === "vehicles" ? plate(rec[nameField]) : norm(rec[nameField])) : "";
    const pre = nk ? created.get(input.target)?.get(nk) : null;
    if (pre) { Object.assign(pre, rec); continue; }
    const rowDefaults = { ...(DEFAULTS[input.target] ?? {}), ...(input.defaults ?? {}) };
    const full = { ...rowDefaults, ...rec };
    if (nk) {
      if (seenNew.has(nk)) problems.push({ row: r.rowNumber, field: nameField!, value: String(rec[nameField!]), error: `Also on row ${seenNew.get(nk)} of the file; both rows were imported` });
      else seenNew.set(nk, String(r.rowNumber));
    }
    out.push({ rowNumber: r.rowNumber, rec: full });
  }

  // write the ERP import workbook
  const wb = new ExcelJS.Workbook();
  const sheets: SheetKey[] = [];
  const writeSheet = (key: SheetKey, rows: { rowNumber: number; rec: any }[]) => {
    const def = SHEET_BY_KEY[key];
    const cols = def.columns.filter((c) => !c.derived);
    const ws = wb.addWorksheet(def.name);
    ws.getRow(1).values = cols.map((c) => c.header);
    for (const { rowNumber, rec } of rows) {
      ws.getRow(rowNumber).values = cols.map((c) => {
        const v = rec[c.key];
        if (v === undefined || v === null) return null;
        return v instanceof Date || typeof v === "number" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
      });
    }
    sheets.push(key);
  };
  for (const [key, recs] of created) if (key !== input.target) writeSheet(key, [...recs.values()].map((rec, i) => ({ rowNumber: i + 2, rec })));
  const extra = created.get(input.target) ? [...created.get(input.target)!.values()].filter((c) => !out.some((o) => o.rec.id === c.id)) : [];
  const last = Math.max(table.headerRow, ...out.map((o) => o.rowNumber));
  writeSheet(input.target, [...out, ...extra.map((rec, i) => ({ rowNumber: last + 2 + i, rec }))]);
  const tmp = path.join(os.tmpdir(), `grl-import-${Date.now()}.xlsx`);
  await wb.xlsx.writeFile(tmp);
  const staged = stageUpload(tmp, `IMPORT_${input.target}_${stamp()}.xlsx`);

  return {
    ...staged,
    target: input.target,
    sheets,
    summary: {
      sourceFile: input.fileName, sourceSheet: table.name, rowsInFile: table.rows.length, rowsToImport: out.length + extra.length,
      matchedExisting: matched, skippedExisting: skipped,
      newMasters: Object.fromEntries([...created].filter(([k]) => k !== input.target).map(([k, m]) => [SHEET_BY_KEY[k].label, [...m.values()].map((r) => r[REF_LOOKUP[k]!.nameField])])),
    },
    problems,
  };
}
