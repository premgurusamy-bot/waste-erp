/**
 * Excel restore / import engine.
 *
 *   analyze()  read-only: verifies checksum + versions, validates every sheet, column, value, ID and relationship,
 *              and classifies each record as NEW / UPDATED / DUPLICATE (already identical) / INVALID.
 *   execute()  runs inside ONE database transaction. Any failure - including the final record-count and
 *              financial-total verification - rolls everything back, so the database is never half restored.
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma, type Tx } from "../db.js";
import { SHEETS, SHEET_BY_KEY, INSERT_ORDER, LOCAL_SETTING, type SheetDef, type SheetKey, type Col } from "./sheets.js";
import { dbValue } from "./canonical.js";
import { rowObject, type ParsedBackup } from "./excel-read.js";
import { loadAll, buildLookups, canonicalRows, type Dataset } from "./excel-export.js";
import { computeFinancials, FINANCIAL_LABELS, type FinancialTotals } from "./financials.js";
import { SCHEMA_VERSION, APP_VERSION, num } from "../../shared/calc.js";
import { nextCode, syncSequences } from "../sequence.js";

export type RestoreMode = "FULL" | "MERGE" | "IMPORT";

export type RestoreIssue = {
  severity: "ERROR" | "WARNING";
  sheet: string;
  row: number | null;
  recordId: string;
  field: string;
  error: string;
  suggestedFix: string;
};

export type SheetPlan = {
  key: SheetKey;
  name: string;
  label: string;
  selected: boolean;
  inFile: number;
  newRecords: number;
  updatedRecords: number;
  duplicateRecords: number;
  invalidRecords: number;
  toRemove: number;
};

export type Verification = {
  isErpBackup: boolean;
  checksumOk: boolean | null;
  expectedChecksum: string | null;
  actualChecksum: string;
  damagedSheets: string[];
  schemaVersion: string | null;
  appVersion: string | null;
  versionOk: boolean;
  message: string;
};

export type RestorePlan = {
  mode: RestoreMode;
  verification: Verification;
  info: Record<string, string>;
  backupFinancials: Record<string, number>;
  sheets: SheetPlan[];
  issues: RestoreIssue[];
  errorCount: number;
  warningCount: number;
  blockers: string[];
  canProceed: boolean;
  needsSkipInvalidConfirmation: boolean;
};

type Prepared = { def: SheetDef; create: any[]; update: { id: string; data: any }[]; validIds: Set<string>; needCode: any[] };
export type Analysis = { plan: RestorePlan; prepared: Map<SheetKey, Prepared>; parsed: ParsedBackup };

export const VERIFY_FAILED = "Backup verification failed. The file may be damaged or modified.";

const CODE_PREFIX: Partial<Record<SheetKey, [string, string]>> = {
  customers: ["code", "CUS"], transporters: ["code", "TRN"], vehicles: ["code", "VEH"], drivers: ["code", "DRV"],
  loadingPoints: ["code", "LP"], deliveryPoints: ["code", "DP"], freight: ["code", "FRT"], trips: ["tripNumber", "TRP"],
  expenses: ["code", "EXP"], receipts: ["code", "RCP"], settlements: ["code", "STL"], payments: ["code", "TPY"], documents: ["code", "DOC"],
};

/** Field metadata from the Prisma schema: which columns are NOT NULL and which have defaults. */
function modelFields(def: SheetDef) {
  const modelName = def.model[0].toUpperCase() + def.model.slice(1);
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === modelName);
  if (!model) throw new Error(`Unknown model ${modelName}`);
  return new Map(model.fields.map((f) => [f.name, f]));
}

const singular = (def: SheetDef) => def.label.replace(/ies$/, "y").replace(/s$/, "");

export function verifyParsed(parsed: ParsedBackup): Verification {
  if (!parsed.hasInfo) {
    return { isErpBackup: false, checksumOk: null, expectedChecksum: null, actualChecksum: parsed.computedChecksum, damagedSheets: [], schemaVersion: null, appVersion: null, versionOk: true, message: "This file has no 00_BackupInfo sheet, so it is not an ERP backup. It can only be used with IMPORT ONLY (data entry import)." };
  }
  const expected = parsed.info["Checksum"] || null;
  const checksumOk = !!expected && expected === parsed.computedChecksum;
  const damagedSheets: string[] = [];
  for (const def of SHEETS) {
    const want = parsed.sheetInfo[def.name];
    const got = parsed.computedSheetHashes[def.name];
    const count = parsed.sheets[def.key].rows.length;
    if (!want || want.hash !== got || want.count !== count) damagedSheets.push(def.name);
  }
  const schemaVersion = parsed.info["Schema Version"] || null;
  const versionOk = !!schemaVersion && Number(schemaVersion) <= Number(SCHEMA_VERSION);
  let message = checksumOk ? "Backup verified: checksum matches." : VERIFY_FAILED;
  if (checksumOk && !versionOk) message = `This backup uses schema version ${schemaVersion}, newer than this ERP (schema ${SCHEMA_VERSION}, app ${APP_VERSION}). Update the ERP first.`;
  return { isErpBackup: true, checksumOk, expectedChecksum: expected, actualChecksum: parsed.computedChecksum, damagedSheets, schemaVersion, appVersion: parsed.info["Application Version"] || null, versionOk, message };
}

function compareKeys(def: SheetDef) {
  return def.columns.map((c, i) => ({ c, i })).filter(({ c }) => !c.derived);
}

export async function analyze(parsed: ParsedBackup, mode: RestoreMode, opts: { sheets?: SheetKey[]; skipInvalid?: boolean } = {}): Promise<Analysis> {
  const verification = verifyParsed(parsed);
  const blockers: string[] = [];
  const issues: RestoreIssue[] = [];
  const isTemplate = !verification.isErpBackup;

  if (isTemplate && mode !== "IMPORT") blockers.push("FULL RESTORE and MERGE need an ERP backup file (with the 00_BackupInfo sheet). Use IMPORT ONLY for other Excel files.");
  if (verification.isErpBackup && !verification.checksumOk) {
    blockers.push(VERIFY_FAILED);
    if (verification.damagedSheets.length) blockers.push(`Sheets that do not match their checksum: ${verification.damagedSheets.join(", ")}`);
  }
  if (verification.isErpBackup && !verification.versionOk) blockers.push(verification.message);

  const selected = new Set<SheetKey>(mode === "IMPORT" ? (opts.sheets?.length ? opts.sheets : SHEETS.filter((d) => parsed.sheets[d.key].present).map((d) => d.key)) : SHEETS.map((d) => d.key));
  if (mode === "IMPORT") for (const k of selected) if (!parsed.sheets[k]?.present) blockers.push(`Sheet ${SHEET_BY_KEY[k].name} is not in the file.`);
  if (mode === "FULL") {
    const missing = SHEETS.filter((d) => !parsed.sheets[d.key].present).map((d) => d.name);
    if (missing.length) blockers.push(`The backup is missing sheets: ${missing.join(", ")}`);
  }
  for (const k of selected) {
    const ps = parsed.sheets[k];
    // in a hand-made import file the ID and code columns may be left out: the ERP creates them
    const autoCols = isTemplate ? [ps.def.columns.find((c) => c.key === "id")?.header, ps.def.columns.find((c) => c.key === CODE_PREFIX[k]?.[0])?.header] : [];
    const missingReq = ps.missingRequiredColumns.filter((h) => !autoCols.includes(h));
    if (ps.present && missingReq.length) blockers.push(`Sheet ${ps.def.name} is missing required columns: ${missingReq.join(", ")}`);
    if (ps.present && ps.missingColumns.length && !isTemplate) {
      const nonDerived = ps.missingColumns.filter((h) => !ps.def.columns.find((c) => c.header === h)?.derived);
      if (nonDerived.length) issues.push({ severity: "WARNING", sheet: ps.def.name, row: null, recordId: "", field: nonDerived.join(", "), error: "Columns missing from the sheet", suggestedFix: "These fields will be left empty." });
    }
  }

  // current database (to classify records and check references)
  const current = await loadAll(prisma);
  const lookups = buildLookups(current);
  const dbIds: Record<string, Set<string>> = {};
  const dbCanon: Record<string, Map<string, string[]>> = {};
  const dbUnique: Record<string, Map<string, string>> = {};
  for (const def of SHEETS) {
    const rows = current[def.key];
    dbIds[def.key] = new Set(rows.map((r: any) => r[def.idKey]));
    const canonRows = canonicalRows(def, rows, lookups);
    const keys = compareKeys(def);
    dbCanon[def.key] = new Map(rows.map((r: any, i: number) => [r[def.idKey], keys.map(({ i: ci }) => canonRows[i][ci])]));
    for (const u of def.uniques ?? []) dbUnique[`${def.key}.${u}`] = new Map(rows.filter((r: any) => r[u]).map((r: any) => [String(r[u]).toUpperCase(), r[def.idKey]]));
  }

  const prepared = new Map<SheetKey, Prepared>();
  const validIds: Record<string, Set<string>> = {};
  const sheetPlans: SheetPlan[] = [];
  const companyInDb = current.company[0]?.id as string | undefined;

  for (const key of INSERT_ORDER) {
    const def = SHEET_BY_KEY[key];
    const ps = parsed.sheets[key];
    const plan: SheetPlan = { key, name: def.name, label: def.label, selected: selected.has(key), inFile: ps.rows.length, newRecords: 0, updatedRecords: 0, duplicateRecords: 0, invalidRecords: 0, toRemove: 0 };
    sheetPlans.push(plan);
    if (!selected.has(key)) continue;
    const fields = modelFields(def);
    const prep: Prepared = { def, create: [], update: [], validIds: new Set(), needCode: [] };
    prepared.set(key, prep);
    validIds[key] = prep.validIds;
    const seenIds = new Map<string, number>();
    const seenUnique = new Map<string, number>();
    const keys = compareKeys(def);
    const idCol = def.columns.findIndex((c) => c.key === def.idKey);

    for (const row of ps.rows) {
      const o = rowObject(def, row.cells);
      let rid = o[def.idKey];
      const label = (def.codeKey && o[def.codeKey]) || rid || `row ${row.rowNumber}`;
      const rowIssues: RestoreIssue[] = row.issues.map((x) => ({ severity: "ERROR", sheet: def.name, row: row.rowNumber, recordId: label, field: x.column, error: x.message, suggestedFix: "Correct the value in Excel and try again." }));
      const err = (field: string, error: string, suggestedFix: string) => rowIssues.push({ severity: "ERROR", sheet: def.name, row: row.rowNumber, recordId: label, field, error, suggestedFix });

      if (!rid) {
        if (isTemplate && def.idKey === "id") { rid = randomUUID(); o.id = rid; row.cells[idCol] = rid; }
        else err(def.columns[idCol].header, "Missing ID", "Every record needs its permanent ID. Do not delete the ID column values.");
      } else if (rid.length > 100) err(def.columns[idCol].header, "ID is too long", "Use the ID exported by the ERP.");
      if (rid) {
        if (seenIds.has(rid)) err(def.columns[idCol].header, `Duplicate ID (also on row ${seenIds.get(rid)})`, "Each row needs a unique ID. Remove the duplicate row.");
        else seenIds.set(rid, row.rowNumber);
      }
      if (key === "settings" && rid && LOCAL_SETTING(rid)) continue; // never import machine-specific settings

      const badCells = new Set(row.issues.map((x) => x.column));
      for (const c of def.columns) {
        if (c.derived || c.key === def.idKey || badCells.has(c.header)) continue;
        const v = o[c.key];
        const f = fields.get(c.key);
        const codeAuto = isTemplate && CODE_PREFIX[key]?.[0] === c.key;
        if (!v && (c.required || (f?.isRequired && !f?.hasDefaultValue && !f?.isUpdatedAt && f.kind === "scalar")) && !codeAuto) err(c.header, `${c.header} is required`, `Fill in ${c.header}.`);
        if (v && c.enum && !c.enum.includes(v.toUpperCase())) err(c.header, `"${v}" is not a valid ${c.header}`, `Use one of: ${c.enum.join(", ")}`);
        if (v && c.ref) {
          const refDef = SHEET_BY_KEY[c.ref];
          const inFile = validIds[c.ref]?.has(v);
          const inDb = mode !== "FULL" && dbIds[c.ref].has(v);
          if (!inFile && !inDb) {
            const fileHasInvalid = parsed.sheets[c.ref].rows.some((r) => rowObject(refDef, r.cells)[refDef.idKey] === v);
            err(c.header, fileHasInvalid
              ? `${singular(def)} ${label} references ${c.header} ${v}, which has errors and cannot be imported`
              : `${singular(def)} ${label} references missing ${c.header} ${v}`,
              fileHasInvalid ? `Fix the ${singular(refDef)} first.` : `Add the ${singular(refDef)} with this ID to sheet ${refDef.name}, or correct the ID.`);
          }
        }
      }
      for (const u of def.uniques ?? []) {
        const v = o[u];
        if (!v) continue;
        const col = def.columns.find((c) => c.key === u)!;
        const k = `${u}:${v.toUpperCase()}`;
        if (seenUnique.has(k)) err(col.header, `Duplicate ${col.header} "${v}" (also on row ${seenUnique.get(k)})`, `${col.header} must be unique.`);
        else seenUnique.set(k, row.rowNumber);
        const owner = mode !== "FULL" ? dbUnique[`${key}.${u}`]?.get(v.toUpperCase()) : undefined;
        if (owner && owner !== rid) err(col.header, `${col.header} "${v}" already belongs to another record in the database (ID ${owner})`, `Use that record's ID ${owner}, or a different ${col.header}.`);
      }

      if (rowIssues.length) {
        plan.invalidRecords++;
        issues.push(...rowIssues);
        continue;
      }

      // build the database object
      const data: any = {};
      for (const c of def.columns) {
        if (c.derived) continue;
        const f = fields.get(c.key);
        if (!f) continue;
        let v = dbValue(c.type, o[c.key]);
        if (c.enum && typeof v === "string") v = v.toUpperCase();
        if (v === null && f.isRequired) continue; // database default applies
        data[c.key] = v;
      }
      if (key === "company" && mode !== "FULL" && companyInDb && companyInDb !== rid) {
        issues.push({ severity: "WARNING", sheet: def.name, row: row.rowNumber, recordId: label, field: "", error: "A different company profile already exists", suggestedFix: "The current company profile is kept. Use FULL RESTORE to replace it." });
        plan.duplicateRecords++;
        continue;
      }
      prep.validIds.add(rid);
      const existing = mode === "FULL" ? undefined : dbCanon[key].get(rid);
      const fileCanon = keys.map(({ i }) => row.cells[i]);
      const dbExisting = dbCanon[key].get(rid);
      if (mode === "FULL") {
        prep.create.push(data);
        if (!dbExisting) plan.newRecords++;
        else if (dbExisting.join("\u001f") === fileCanon.join("\u001f")) plan.duplicateRecords++;
        else plan.updatedRecords++;
      } else if (!existing) {
        prep.create.push(data);
        plan.newRecords++;
      } else if (existing.join("\u001f") === fileCanon.join("\u001f")) {
        plan.duplicateRecords++;
      } else {
        const { [def.idKey]: _omit, ...rest } = data;
        prep.update.push({ id: rid, data: rest });
        plan.updatedRecords++;
      }
      const cp = CODE_PREFIX[key];
      if (cp && !data[cp[0]]) prep.needCode.push(data);
    }
    if (mode === "FULL") {
      const fileIds = prep.validIds;
      plan.toRemove = [...dbIds[key]].filter((x) => !fileIds.has(x) && !(key === "settings" && LOCAL_SETTING(x))).length;
    }
  }

  // documents whose files are not on this computer
  const errorCount = issues.filter((i) => i.severity === "ERROR").length;
  const warningCount = issues.length - errorCount;
  const needsSkipInvalidConfirmation = errorCount > 0 && mode !== "FULL" && blockers.length === 0;
  if (errorCount > 0 && mode === "FULL") blockers.push(`${errorCount} error(s) found. FULL RESTORE only runs on a backup without errors.`);
  if (errorCount > 0 && mode !== "FULL" && !opts.skipInvalid) blockers.push(`${errorCount} error(s) found. Fix them in Excel, or confirm "Skip invalid records" to import only the valid ones.`);
  const plan: RestorePlan = {
    mode, verification, info: parsed.info, backupFinancials: parsed.financials, sheets: sheetPlans, issues,
    errorCount, warningCount, blockers, canProceed: blockers.length === 0, needsSkipInvalidConfirmation,
  };
  return { plan, prepared, parsed };
}

export class DryRunComplete extends Error {
  constructor(public result: ExecuteResult) { super("dry run"); }
}

export type ExecuteResult = {
  mode: RestoreMode;
  counts: { sheet: string; label: string; expected: number; actual: number; ok: boolean }[];
  financialCheck: { field: string; label: string; backup: number | null; restored: number; ok: boolean | null }[];
  financialsBefore: FinancialTotals;
  financialsAfter: FinancialTotals;
  created: number;
  updated: number;
  skippedInvalid: number;
  dryRun: boolean;
};

const CHUNK = 1000;

/** Apply an analysed restore inside a single transaction. Throws (and rolls back) when verification fails. */
export async function execute(a: Analysis, opts: { dryRun?: boolean; userName: string; fileName: string }): Promise<ExecuteResult> {
  if (!a.plan.canProceed) throw new Error(a.plan.blockers.join(" "));
  const mode = a.plan.mode;
  const run = async (tx: Tx): Promise<ExecuteResult> => {
    const before = computeFinancials(await loadAll(tx));
    if (mode === "FULL") {
      for (const key of [...INSERT_ORDER].reverse()) {
        const def = SHEET_BY_KEY[key];
        const where = key === "settings" ? { NOT: [{ key: { startsWith: "license." } }, { key: { startsWith: "local." } }] } : {};
        await (tx as any)[def.model].deleteMany({ where });
      }
    }
    let created = 0, updated = 0;
    for (const key of INSERT_ORDER) {
      const p = a.prepared.get(key);
      if (!p) continue;
      const cp = CODE_PREFIX[key];
      for (const row of p.needCode) row[cp![0]] = await nextCode(tx, cp![1]);
      const delegate = (tx as any)[p.def.model];
      for (let i = 0; i < p.create.length; i += CHUNK) {
        const r = await delegate.createMany({ data: p.create.slice(i, i + CHUNK) });
        created += r.count;
      }
      for (const u of p.update) {
        await delegate.update({ where: { [p.def.idKey]: u.id }, data: u.data });
        updated++;
      }
    }
    await syncSequences(tx);
    // trips that arrive through MERGE / IMPORT get their transporter settlement, like trips entered on screen
    if (mode !== "FULL") {
      const open = await tx.trip.findMany({ where: { transporterId: { not: null }, status: { not: "CANCELLED" }, settlement: null }, select: { id: true, transporterId: true } });
      for (const t of open) await tx.transporterSettlement.create({ data: { code: await nextCode(tx, "STL"), tripId: t.id, transporterId: t.transporterId!, status: "PENDING" } });
    }

    // ---- verify record counts
    const counts: ExecuteResult["counts"] = [];
    for (const key of INSERT_ORDER) {
      const p = a.prepared.get(key);
      if (!p) continue;
      const delegate = (tx as any)[p.def.model];
      const ids = [...p.validIds];
      let actual = 0;
      if (mode === "FULL") {
        const where = key === "settings" ? { NOT: [{ key: { startsWith: "license." } }, { key: { startsWith: "local." } }] } : {};
        actual = await delegate.count({ where });
      } else {
        for (let i = 0; i < ids.length; i += 5000) actual += await delegate.count({ where: { [p.def.idKey]: { in: ids.slice(i, i + 5000) } } });
      }
      counts.push({ sheet: p.def.name, label: p.def.label, expected: ids.length, actual, ok: actual === ids.length });
    }
    const badCount = counts.filter((c) => !c.ok);
    if (badCount.length) throw new Error(`Record count verification failed: ${badCount.map((c) => `${c.label} expected ${c.expected}, found ${c.actual}`).join("; ")}`);

    // ---- verify financial totals (must match exactly after a full restore of a verified backup)
    const after = computeFinancials(await loadAll(tx));
    const strict = mode === "FULL" && a.plan.verification.checksumOk === true;
    const financialCheck = (Object.keys(FINANCIAL_LABELS) as (keyof FinancialTotals)[]).map((k) => {
      const backup = a.parsed.financials[k] ?? null;
      const ok = strict ? backup !== null && Math.abs(num(backup) - after[k]) < 0.005 : null;
      return { field: k, label: FINANCIAL_LABELS[k], backup, restored: after[k], ok };
    });
    if (strict && financialCheck.some((f) => f.ok === false)) {
      throw new Error(`Financial verification failed: ${financialCheck.filter((f) => f.ok === false).map((f) => `${f.label} backup ${f.backup} vs restored ${f.restored}`).join("; ")}`);
    }
    const result: ExecuteResult = { mode, counts, financialCheck, financialsBefore: before, financialsAfter: after, created, updated, skippedInvalid: a.plan.errorCount, dryRun: !!opts.dryRun };
    if (opts.dryRun) throw new DryRunComplete(result);
    await tx.auditLog.create({ data: { userName: opts.userName, action: mode === "IMPORT" ? "IMPORT" : "RESTORE", entityType: "BACKUP", recordCode: opts.fileName, newValue: { mode, created, updated, skippedInvalid: a.plan.errorCount } } });
    return result;
  };
  try {
    return await prisma.$transaction(run, { timeout: 30 * 60_000, maxWait: 60_000 });
  } catch (e) {
    if (e instanceof DryRunComplete) return e.result;
    throw e;
  }
}

/** After a restore: rebuild indexes and refresh planner statistics. */
export async function rebuildIndexes() {
  const tables = ["customers", "transporters", "vehicles", "drivers", "loading_points", "delivery_points", "freight_rates", "trips", "trip_items", "expenses",
    "customer_invoices", "invoice_items", "customer_receipts", "transporter_settlements", "transporter_payments", "documents", "vehicle_documents",
    "driver_documents", "targets", "notifications", "audit_logs", "settings", "company"];
  for (const t of tables) {
    await prisma.$executeRawUnsafe(`REINDEX TABLE "${t}"`);
    await prisma.$executeRawUnsafe(`ANALYZE "${t}"`);
  }
}

export type { Dataset, Col };
