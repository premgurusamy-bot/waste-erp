import ExcelJS from "exceljs";
import { prisma, type Tx } from "../db.js";
import { plain } from "../lib/util.js";
import { num, round2, APP_VERSION, SCHEMA_VERSION } from "../../shared/calc.js";
import { SHEETS, INFO_SHEET, LOCAL_SETTING, type SheetDef, type SheetKey, type Lookups } from "./sheets.js";
import { canon, excelValue, sheetHash, overallChecksum } from "./canonical.js";
import { computeFinancials, FINANCIAL_LABELS, type FinancialTotals } from "./financials.js";

export type Dataset = Record<SheetKey, any[]>;

const ORDER: Partial<Record<SheetKey, any>> = {
  customers: { code: "asc" }, transporters: { code: "asc" }, vehicles: { code: "asc" }, drivers: { code: "asc" },
  loadingPoints: { code: "asc" }, deliveryPoints: { code: "asc" }, freight: { code: "asc" },
  trips: [{ tripDate: "asc" }, { tripNumber: "asc" }], tripItems: [{ tripId: "asc" }, { lineNo: "asc" }],
  expenses: [{ expenseDate: "asc" }, { code: "asc" }], invoices: [{ invoiceDate: "asc" }, { invoiceNumber: "asc" }],
  invoiceItems: [{ invoiceId: "asc" }, { lineNo: "asc" }], receipts: [{ receiptDate: "asc" }, { code: "asc" }],
  settlements: { code: "asc" }, payments: [{ paymentDate: "asc" }, { code: "asc" }], documents: { code: "asc" },
  auditLogs: [{ at: "asc" }, { id: "asc" }], settings: { key: "asc" }, notifications: { createdAt: "asc" },
};

/** Read every business table as plain JSON rows. */
export async function loadAll(db: Tx | typeof prisma = prisma): Promise<Dataset> {
  const out = {} as Dataset;
  for (const def of SHEETS) {
    const delegate = (db as any)[def.model];
    const orderBy = ORDER[def.key] ?? [{ createdAt: "asc" }, { id: "asc" }];
    let rows = (await delegate.findMany({ orderBy })).map(plain);
    if (def.key === "settings") rows = rows.filter((r: any) => !LOCAL_SETTING(r.key));
    // JSON columns travel as JSON text, so a JSON string value cannot be confused with JSON syntax
    const jsonCols = def.columns.filter((c) => c.type === "json").map((c) => c.key);
    if (jsonCols.length) for (const r of rows) for (const k of jsonCols) if (r[k] !== null && r[k] !== undefined) r[k] = JSON.stringify(r[k]);
    out[def.key] = rows;
  }
  return out;
}

export function buildLookups(data: Partial<Dataset>): Lookups {
  const l: Lookups = {};
  for (const k of ["customers", "transporters", "vehicles", "drivers", "loadingPoints", "deliveryPoints", "trips", "invoices", "settlements"] as SheetKey[]) {
    l[k] = new Map((data[k] ?? []).map((r: any) => [r.id, r]));
  }
  const received = new Map<string, number>();
  for (const r of data.receipts ?? []) {
    if (r.status === "CANCELLED" || !r.invoiceId) continue;
    received.set(r.invoiceId, round2((received.get(r.invoiceId) ?? 0) + num(r.amount) + num(r.tdsAmount)));
  }
  const paid = new Map<string, number>();
  for (const p of data.payments ?? []) {
    if (p.status === "CANCELLED" || !p.settlementId) continue;
    paid.set(p.settlementId, round2((paid.get(p.settlementId) ?? 0) + num(p.amount)));
  }
  l.invoiceReceived = received;
  l.settlementPaid = paid;
  return l;
}

/** Canonical cell strings for every row of a sheet, including the calculated (grey) columns. */
export function canonicalRows(def: SheetDef, rows: any[], lookups: Lookups): string[][] {
  return rows.map((row) => {
    const full = def.derive ? { ...row, ...def.derive(row, lookups) } : row;
    return def.columns.map((c) => canon(c.type, full[c.key]));
  });
}

export type BackupMeta = {
  backupId: string;
  type: string;
  createdBy: string;
  companyName: string;
  companyGstin: string;
  databaseVersion: string;
  createdAt: Date;
};

export type WrittenBackup = {
  checksum: string;
  counts: Record<string, number>;
  totalRecords: number;
  financials: FinancialTotals;
};

export const INFO_FIELDS = [
  "Backup ID", "Application Version", "Company Name", "Company GSTIN", "Backup Date", "Backup Time", "Database Version", "Schema Version",
  "Number of Customers", "Number of Transporters", "Number of Vehicles", "Number of Drivers", "Number of Trips", "Number of Expenses",
  "Number of Invoices", "Number of Payments", "Total Records", "Checksum", "Created By", "Backup Type", "Checksum Algorithm",
] as const;

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } } as const;
const DERIVED_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF7F8C8D" } } as const;
const NUMFMT: Record<string, string> = { money: "#,##0.00", pct: "0.00", qty: "#,##0.000", km: "#,##0.0", int: "0", date: "dd-mm-yyyy" };

function colLetter(n: number) {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/**
 * Write the backup workbook: 00_BackupInfo followed by one sheet per table.
 * Uses the streaming writer so large databases (100,000+ rows) do not exhaust memory.
 */
export async function writeBackupWorkbook(filePath: string, data: Dataset, meta: BackupMeta): Promise<WrittenBackup> {
  const lookups = buildLookups(data);
  const sheets = SHEETS.map((def) => {
    const rows = canonicalRows(def, data[def.key], lookups);
    return { def, rows, hash: sheetHash(def, rows) };
  });
  const financials = computeFinancials(data);
  const parts = sheets.map((s) => ({ name: s.def.name, count: s.rows.length, hash: s.hash }));
  const checksum = overallChecksum(parts, financials);
  const counts = Object.fromEntries(sheets.map((s) => [s.def.key, s.rows.length]));
  const totalRecords = sheets.reduce((a, s) => a + s.rows.length, 0);

  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath, useStyles: true, useSharedStrings: true });
  wb.creator = "G Road Lines ERP";
  wb.created = meta.createdAt;

  // ---- 00_BackupInfo
  const info = wb.addWorksheet(INFO_SHEET, { views: [{ state: "frozen", ySplit: 1 }] });
  info.columns = [{ header: "Field", key: "a", width: 30 }, { header: "Value", key: "b", width: 70 }, { header: "", key: "c", width: 70 }];
  info.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  info.getRow(1).fill = HEADER_FILL as any;
  info.getRow(1).commit();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const dt = meta.createdAt;
  const values: Record<(typeof INFO_FIELDS)[number], string | number> = {
    "Backup ID": meta.backupId,
    "Application Version": APP_VERSION,
    "Company Name": meta.companyName,
    "Company GSTIN": meta.companyGstin,
    "Backup Date": `${p2(dt.getDate())}-${p2(dt.getMonth() + 1)}-${dt.getFullYear()}`,
    "Backup Time": `${p2(dt.getHours())}:${p2(dt.getMinutes())}:${p2(dt.getSeconds())}`,
    "Database Version": meta.databaseVersion,
    "Schema Version": SCHEMA_VERSION,
    "Number of Customers": counts.customers,
    "Number of Transporters": counts.transporters,
    "Number of Vehicles": counts.vehicles,
    "Number of Drivers": counts.drivers,
    "Number of Trips": counts.trips,
    "Number of Expenses": counts.expenses,
    "Number of Invoices": counts.invoices,
    "Number of Payments": counts.receipts + counts.payments,
    "Total Records": totalRecords,
    Checksum: checksum,
    "Created By": meta.createdBy,
    "Backup Type": meta.type,
    "Checksum Algorithm": "SHA-256 of the canonical values of sheets 01-23, record counts and financial totals",
  };
  for (const f of INFO_FIELDS) info.addRow({ a: f, b: values[f] }).commit();
  info.addRow({}).commit();
  const sh = info.addRow({ a: "Sheet", b: "Records", c: "Sheet Checksum (SHA-256)" });
  sh.font = { bold: true };
  sh.commit();
  for (const p of parts) info.addRow({ a: p.name, b: p.count, c: p.hash }).commit();
  info.addRow({}).commit();
  const fh = info.addRow({ a: "Financial Total", b: "Value" });
  fh.font = { bold: true };
  fh.commit();
  for (const [k, label] of Object.entries(FINANCIAL_LABELS)) info.addRow({ a: label, b: (financials as any)[k] }).commit();
  info.addRow({}).commit();
  info.addRow({ a: "Notes", b: "Grey columns are calculated for reading only and are ignored when restoring. The ERP database is the source of truth; no Excel formulas are used for financial figures. Editing any value makes backup verification fail." }).commit();
  info.commit();

  // ---- data sheets
  for (const { def, rows } of sheets) {
    const ws = wb.addWorksheet(def.name, { views: [{ state: "frozen", ySplit: 1, xSplit: 0 }] });
    ws.columns = def.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? Math.max(12, c.header.length + 2), style: NUMFMT[c.type] ? { numFmt: NUMFMT[c.type] } : {} }));
    ws.autoFilter = { from: "A1", to: `${colLetter(def.columns.length)}${Math.max(1, rows.length + 1)}` };
    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    def.columns.forEach((c, i) => { header.getCell(i + 1).fill = (c.derived ? DERIVED_FILL : HEADER_FILL) as any; });
    header.commit();
    const totals = def.columns.map(() => 0);
    for (const r of rows) {
      const row = ws.addRow(def.columns.map((c, i) => {
        if (c.total && r[i] !== "") totals[i] += Number(r[i]);
        return excelValue(c.type, r[i]);
      }));
      def.columns.forEach((c, i) => { if (c.derived) row.getCell(i + 1).font = { italic: true, color: { argb: "FF555555" } }; });
      row.commit();
    }
    if (rows.length && def.columns.some((c) => c.total)) {
      const t = ws.addRow(def.columns.map((c, i) => (i === 0 ? "TOTAL" : c.total ? round2(totals[i]) : null)));
      t.font = { bold: true };
      t.commit();
    }
    ws.commit();
  }
  await wb.commit();
  return { checksum, counts, totalRecords, financials };
}
