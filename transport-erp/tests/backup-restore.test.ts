/**
 * THE MOST IMPORTANT TEST:
 *   CREATE DATA -> EXPORT EXCEL -> DELETE THE DATABASE -> RESTORE FROM EXCEL -> VERIFY DATA IS IDENTICAL
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { prisma } from "../src/server/db.js";
import { seedBase, seedDemo } from "../src/server/seed/seed.js";
import { createExcelBackup, emergencyBackup, exportAll, retentionPlan, backupHealth } from "../src/server/backup/service.js";
import { readBackupWorkbook } from "../src/server/backup/excel-read.js";
import { analyze, verifyParsed, VERIFY_FAILED } from "../src/server/backup/restore.js";
import { runRestore, rollback } from "../src/server/backup/restore-service.js";
import { loadAll, buildLookups, canonicalRows, writeBackupWorkbook, type Dataset } from "../src/server/backup/excel-export.js";
import { computeFinancials } from "../src/server/backup/financials.js";
import { SHEETS } from "../src/server/backup/sheets.js";
import { saveMaster } from "../src/server/services/masters.js";
import { saveTrip } from "../src/server/services/trips.js";
import { adminCtx, wipeAll, dropAndRecreateDatabase } from "./helpers.js";
import { todayIst } from "../src/shared/calc.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grl-test-"));

/** Every stored value of every business table, as canonical text, sorted by ID. */
function snapshot(d: Dataset) {
  const l = buildLookups(d);
  const out: Record<string, string[]> = {};
  for (const def of SHEETS) {
    const keep = def.columns.map((c, i) => ({ c, i })).filter(({ c }) => !c.derived);
    out[def.name] = canonicalRows(def, d[def.key], l).map((r) => keep.map(({ i }) => r[i]).join("|")).sort();
  }
  return out;
}

const counts = async () => ({
  customers: await prisma.customer.count(), transporters: await prisma.transporter.count(), vehicles: await prisma.vehicle.count(), drivers: await prisma.driver.count(),
  trips: await prisma.trip.count(), expenses: await prisma.expense.count(), invoices: await prisma.customerInvoice.count(), receipts: await prisma.customerReceipt.count(),
  payments: await prisma.transporterPayment.count(), settlements: await prisma.transporterSettlement.count(), targets: await prisma.target.count(),
});

async function copyBackup(p: string, name: string) {
  const dst = path.join(tmp, name);
  fs.copyFileSync(p, dst);
  return dst;
}

describe("Excel backup and restore", () => {
  let backupFile = "";
  let before: Dataset;

  beforeAll(async () => {
    await wipeAll();
    await seedBase({ adminPassword: "Admin@12345" });
    await seedDemo(adminCtx());
    before = await loadAll();
  });

  it("creates a verified Excel backup with all sheets, metadata and checksum", async () => {
    const b = await createExcelBackup("MANUAL", "Tester", { withDatabase: true });
    expect(b.verified).toBe(true);
    expect(b.fileName).toMatch(/^GRL_ERP_BACKUP_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(_\d+)?\.xlsx$/);
    expect(b.totalRecords).toBeGreaterThan(1000);
    backupFile = await copyBackup(b.filePath, "good.xlsx");

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(b.filePath);
    const names = wb.worksheets.map((w) => w.name);
    expect(names[0]).toBe("00_BackupInfo");
    expect(names.slice(1)).toEqual(SHEETS.map((s) => s.name));
    const info = new Map<string, any>();
    wb.getWorksheet("00_BackupInfo")!.eachRow((r) => info.set(String(r.getCell(1).value), r.getCell(2).value));
    for (const f of ["Backup ID", "Application Version", "Company Name", "Company GSTIN", "Backup Date", "Backup Time", "Database Version", "Schema Version", "Number of Customers", "Number of Transporters", "Number of Vehicles", "Number of Drivers", "Number of Trips", "Number of Expenses", "Number of Invoices", "Number of Payments", "Total Records", "Checksum", "Created By"]) {
      expect(info.has(f), f).toBe(true);
    }
    expect(info.get("Number of Customers")).toBe(20);
    expect(info.get("Number of Trips")).toBe(100);
    expect(info.get("Number of Expenses")).toBe(200);
    expect(info.get("Number of Invoices")).toBe(50);
    expect(String(info.get("Checksum"))).toMatch(/^[0-9a-f]{64}$/);
    // human readable: frozen header, filter, real dates and numbers
    const trips = wb.getWorksheet("08_Trips")!;
    expect(trips.views[0].state).toBe("frozen");
    expect(trips.autoFilter).toBeTruthy();
    expect(trips.getRow(2).getCell(3).value).toBeInstanceOf(Date);
    expect(typeof trips.getRow(2).getCell(28).value).toBe("number");
    // a new backup never overwrites the previous one
    const b2 = await createExcelBackup("MANUAL", "Tester");
    expect(b2.filePath).not.toBe(b.filePath);
    expect(fs.existsSync(b.filePath)).toBe(true);
  });

  it("CREATE DATA -> EXPORT EXCEL -> DELETE DATABASE -> RESTORE FROM EXCEL -> data, IDs and money are identical", async () => {
    before = await loadAll();
    const b = await createExcelBackup("MANUAL", "Tester");
    backupFile = await copyBackup(b.filePath, "good.xlsx");
    const beforeCounts = await counts();
    const beforeSnap = snapshot(before);
    const beforeFin = computeFinancials(before);
    const parsed = await readBackupWorkbook(backupFile);
    expect(verifyParsed(parsed).checksumOk).toBe(true);

    // the old computer is dead: delete the whole database and build an empty one
    await dropAndRecreateDatabase();
    expect(await prisma.trip.count()).toBe(0);
    // new installation: a fresh company profile and a new admin login
    await seedBase({ adminPassword: "NewPc@12345", companyName: "New Install" });

    const r = await runRestore({ filePath: backupFile, fileName: "good.xlsx", mode: "FULL", userName: "Admin" });
    expect(r.ok, (r as any).message).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe("RESTORE SUCCESSFUL");
    expect(r.result.counts.every((c) => c.ok)).toBe(true);
    expect(r.result.financialCheck.every((f) => f.ok === true)).toBe(true);

    const after = await loadAll();
    expect(await counts()).toEqual(beforeCounts);
    // IDs identical
    for (const def of SHEETS) {
      const ids = after[def.key].map((x: any) => x[def.idKey]);
      if (def.key === "auditLogs") expect(ids).toEqual(expect.arrayContaining(before[def.key].map((x: any) => x.id)));
      else expect(ids.sort(), def.name).toEqual(before[def.key].map((x: any) => x[def.idKey]).sort());
    }
    // every value identical (audit log gains the restore entries, so compare it as a superset)
    const afterSnap = snapshot(after);
    for (const def of SHEETS) {
      if (def.key === "auditLogs") {
        const set = new Set(afterSnap[def.name]);
        expect(beforeSnap[def.name].every((x) => set.has(x))).toBe(true);
      } else expect(afterSnap[def.name], def.name).toEqual(beforeSnap[def.name]);
    }
    // financial totals identical
    const afterFin = computeFinancials(after);
    expect(afterFin).toEqual(beforeFin);
    expect(afterFin.totalTrips).toBe(100);
    // company profile came back from the backup
    expect((await prisma.company.findFirst())?.name).toBe("G Road Lines");
    // the new login still works (users are not part of the business restore)
    expect(await prisma.user.findUnique({ where: { username: "admin" } })).toBeTruthy();
    // numbering continues after the restored records
    const ctx = adminCtx();
    const c = await prisma.customer.findFirst();
    const t = await saveTrip(ctx, { tripDate: todayIst(), customerId: c!.id, customerFreight: 1000 });
    expect(t.tripNumber).toBe("TRP-000101");
  });

  it("refuses a modified backup: 'Backup verification failed. The file may be damaged or modified.'", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(backupFile);
    const ws = wb.getWorksheet("08_Trips")!;
    ws.getRow(2).getCell(28).value = Number(ws.getRow(2).getCell(28).value) + 1; // change one freight amount by 1 rupee
    const bad = path.join(tmp, "tampered.xlsx");
    await wb.xlsx.writeFile(bad);
    const tripsBefore = await prisma.trip.count();
    const plan = (await analyze(await readBackupWorkbook(bad), "FULL")).plan;
    expect(plan.verification.checksumOk).toBe(false);
    expect(plan.verification.damagedSheets).toEqual(["08_Trips"]);
    expect(plan.blockers).toContain(VERIFY_FAILED);
    const r = await runRestore({ filePath: bad, fileName: "tampered.xlsx", mode: "FULL", userName: "Admin" });
    expect(r.ok).toBe(false);
    expect(await prisma.trip.count()).toBe(tripsBefore);
  });

  it("reports missing relationships exactly and does not import them", async () => {
    const data = await loadAll();
    const trip = data.trips.find((t: any) => t.vehicleId)!;
    const vehicle = data.vehicles.find((v: any) => v.id === trip.vehicleId)!;
    const broken = { ...data, vehicles: data.vehicles.filter((v: any) => v.id !== vehicle.id) } as Dataset;
    const p = path.join(tmp, "broken.xlsx");
    await writeBackupWorkbook(p, broken, { backupId: "T", type: "MANUAL", createdBy: "t", companyName: "x", companyGstin: "", databaseVersion: "pg", createdAt: new Date() });
    const plan = (await analyze(await readBackupWorkbook(p), "FULL")).plan;
    expect(plan.verification.checksumOk).toBe(true);
    expect(plan.canProceed).toBe(false);
    const issue = plan.issues.find((i) => i.recordId === trip.tripNumber && i.field === "Vehicle ID")!;
    expect(issue.error).toBe(`Trip ${trip.tripNumber} references missing Vehicle ID ${vehicle.id}`);
    expect(issue.sheet).toBe("08_Trips");
    expect(issue.row).toBeGreaterThan(1);
    expect(issue.suggestedFix).toContain("04_Vehicles");
  });

  it("detects duplicate IDs", async () => {
    const data = await loadAll();
    const dup = { ...data, customers: [...data.customers, { ...data.customers[0], code: "CUS-999999" }] } as Dataset;
    const p = path.join(tmp, "dup.xlsx");
    await writeBackupWorkbook(p, dup, { backupId: "T", type: "MANUAL", createdBy: "t", companyName: "x", companyGstin: "", databaseVersion: "pg", createdAt: new Date() });
    const plan = (await analyze(await readBackupWorkbook(p), "MERGE")).plan;
    expect(plan.issues.some((i) => i.sheet === "02_Customers" && i.error.startsWith("Duplicate ID"))).toBe(true);
    expect(plan.canProceed).toBe(false);
    expect(plan.needsSkipInvalidConfirmation).toBe(true);
  });

  it("MERGE adds missing and updates existing records and NEVER deletes", async () => {
    const ctx = adminCtx();
    const extra = await saveMaster(ctx, "customers", { name: "Added After Backup" });
    const target = await prisma.customer.findFirst({ where: { name: "ABC Manufacturing" } });
    await prisma.customer.update({ where: { id: target!.id }, data: { name: "ABC Renamed" } });
    const deletedExpense = await prisma.expense.findFirst({ where: { tripId: null }, orderBy: { code: "asc" } });
    await prisma.expense.delete({ where: { id: deletedExpense!.id } });
    const preview = (await analyze(await readBackupWorkbook(backupFile), "MERGE")).plan;
    const cust = preview.sheets.find((s) => s.key === "customers")!;
    expect(cust.updatedRecords).toBe(1);
    expect(cust.newRecords).toBe(0);
    expect(preview.sheets.find((s) => s.key === "expenses")!.newRecords).toBe(1);
    const r = await runRestore({ filePath: backupFile, fileName: "good.xlsx", mode: "MERGE", userName: "Admin" });
    expect(r.ok, (r as any).message).toBe(true);
    expect(await prisma.customer.findUnique({ where: { id: extra.id } })).toBeTruthy(); // not deleted
    expect((await prisma.customer.findUnique({ where: { id: target!.id } }))!.name).toBe("ABC Manufacturing"); // updated
    expect(await prisma.expense.findUnique({ where: { id: deletedExpense!.id } })).toBeTruthy(); // added back
  });

  it("IMPORT ONLY loads selected sheets from a hand-made Excel file (IDs and codes created automatically)", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("02_Customers");
    ws.addRow(["Customer ID", "Customer Code", "Customer Name", "Mobile", "Credit Days", "Opening Balance", "Status"]);
    ws.addRow([null, null, "Imported Traders", "9876543210", 45, "12,500", "ACTIVE"]);
    ws.addRow([null, null, "Second Import Co", null, null, 0, "active"]);
    const p = path.join(tmp, "import.xlsx");
    await wb.xlsx.writeFile(p);
    const before = await prisma.customer.count();
    const plan = (await analyze(await readBackupWorkbook(p), "IMPORT", { sheets: ["customers"] })).plan;
    expect(plan.verification.isErpBackup).toBe(false);
    expect(plan.issues).toEqual([]);
    expect(plan.blockers).toEqual([]);
    expect(plan.canProceed).toBe(true);
    expect(plan.sheets.find((s) => s.key === "customers")!.newRecords).toBe(2);
    // FULL restore from a non-backup file is refused
    expect((await analyze(await readBackupWorkbook(p), "FULL")).plan.canProceed).toBe(false);
    const r = await runRestore({ filePath: p, fileName: "import.xlsx", mode: "IMPORT", sheets: ["customers"], userName: "Admin" });
    expect(r.ok, (r as any).message).toBe(true);
    expect(r.status).toBe("IMPORT COMPLETE");
    expect(await prisma.customer.count()).toBe(before + 2);
    const c = await prisma.customer.findFirst({ where: { name: "Imported Traders" } });
    expect(c?.code).toMatch(/^CUS-\d{6}$/);
    expect(Number(c?.openingBalance)).toBe(12500);
    expect(c?.creditDays).toBe(45);
  });

  it("IMPORT with invalid rows fails with exact errors unless 'skip invalid' is confirmed", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("02_Customers");
    ws.addRow(["Customer Name", "Credit Days", "Status"]);
    ws.addRow(["Good Row Ltd", 10, "ACTIVE"]);
    ws.addRow(["", 10, "ACTIVE"]);
    ws.addRow(["Bad Status Ltd", "abc", "MAYBE"]);
    const p = path.join(tmp, "invalid.xlsx");
    await wb.xlsx.writeFile(p);
    const r1 = await runRestore({ filePath: p, fileName: "invalid.xlsx", mode: "IMPORT", userName: "Admin" });
    expect(r1.ok).toBe(false);
    expect(r1.status).toBe("IMPORT FAILED");
    const errs = (r1 as any).plan.issues;
    expect(errs.some((e: any) => e.row === 3 && e.error === "Customer Name is required")).toBe(true);
    expect(errs.some((e: any) => e.row === 4 && e.error.includes('"MAYBE" is not a valid Status'))).toBe(true);
    expect(errs.some((e: any) => e.row === 4 && e.error.includes('"abc" is not a valid number'))).toBe(true);
    expect(fs.existsSync((r1 as any).errorReport)).toBe(true);
    expect(await prisma.customer.findFirst({ where: { name: "Good Row Ltd" } })).toBeNull(); // nothing partially imported
    const r2 = await runRestore({ filePath: p, fileName: "invalid.xlsx", mode: "IMPORT", skipInvalid: true, userName: "Admin" });
    expect(r2.ok).toBe(true);
    expect(await prisma.customer.findFirst({ where: { name: "Good Row Ltd" } })).toBeTruthy();
  });

  it("RESTORE TEST (dry run) proves a backup restores, without changing anything", async () => {
    const snapBefore = snapshot(await loadAll());
    const r = await runRestore({ filePath: backupFile, fileName: "good.xlsx", mode: "FULL", dryRun: true, userName: "Admin" });
    expect(r.ok).toBe(true);
    expect(r.status).toBe("RESTORE TEST PASSED");
    const snapAfter = snapshot(await loadAll());
    for (const def of SHEETS) if (def.key !== "auditLogs") expect(snapAfter[def.name]).toEqual(snapBefore[def.name]);
    expect((await backupHealth()).lastRestoreTestAt).toBeTruthy();
  });

  it("creates a PRE-RESTORE backup before restoring and can ROLL BACK", async () => {
    const ctx = adminCtx();
    const marker = await saveMaster(ctx, "customers", { name: "Exists Before Restore" });
    const r = await runRestore({ filePath: backupFile, fileName: "good.xlsx", mode: "FULL", userName: "Admin" });
    expect(r.ok).toBe(true);
    expect(path.basename(r.preRestoreBackup!)).toMatch(/^PRE_RESTORE_BACKUP_/);
    expect(await prisma.customer.findUnique({ where: { id: marker.id } })).toBeNull(); // replaced by the backup
    const rb = await rollback(r.restoreId, "Admin");
    expect(rb.ok, (rb as any).message).toBe(true);
    expect(await prisma.customer.findUnique({ where: { id: marker.id } })).toBeTruthy(); // back again
    expect((await prisma.restoreRecord.findUnique({ where: { id: r.restoreId } }))!.rolledBack).toBe(true);
  });

  it("EMERGENCY BACKUP and EXPORT ALL DATA produce the complete set of files", async () => {
    const e = await emergencyBackup("Admin");
    expect(e.excel.verified).toBe(true);
    expect(fs.existsSync(e.excel.dbSnapshot!)).toBe(true);
    expect(fs.existsSync(e.documents.manifestPath)).toBe(true);
    expect(fs.existsSync(e.settingsFile)).toBe(true);
    const x = await exportAll("Admin");
    expect(x.fileName).toMatch(/^GRL_ERP_FULL_EXPORT_.*\.zip$/);
    const zip = await JSZip.loadAsync(fs.readFileSync(x.zipPath));
    const files = Object.keys(zip.files);
    expect(files).toContain("Excel/GRL_ERP_DATA.xlsx");
    expect(files).toContain("Manifest/manifest.json");
    expect(files).toContain("Logs/export.log");
    expect(files.some((f) => f.startsWith("Database/"))).toBe(true);
  });

  it("retention only PROPOSES deletions and keeps everything until the user confirms", async () => {
    await prisma.setting.upsert({ where: { key: "backup.keepDaily" }, update: { value: "1" }, create: { key: "backup.keepDaily", value: "1" } });
    const plan = await retentionPlan();
    expect(plan.candidates.length).toBeGreaterThan(0);
    for (const c of plan.candidates) expect(fs.existsSync(c.path)).toBe(true);
    await prisma.setting.update({ where: { key: "backup.keepDaily" }, data: { value: "30" } });
  });
});
