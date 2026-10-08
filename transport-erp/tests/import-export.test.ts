import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { prisma } from "../src/server/db.js";
import { seedBase } from "../src/server/seed/seed.js";
import { saveMaster } from "../src/server/services/masters.js";
import { readAnyFile, detectDelimiter, splitDelimited } from "../src/server/import/parse.js";
import { suggestMapping, importFields } from "../src/server/import/targets.js";
import { prepareImport } from "../src/server/import/convert.js";
import { preview, runRestore, stagedPath } from "../src/server/backup/restore-service.js";
import { exportData, EXPORT_FORMATS } from "../src/server/export/data-export.js";
import { adminCtx, wipeAll } from "./helpers.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grl-imp-"));
const file = (name: string, content: string | Buffer) => { const p = path.join(dir, name); fs.writeFileSync(p, content); return p; };
const mappingFor = (target: any, headers: string[]) => Object.fromEntries(Object.entries(suggestMapping(target, headers)).map(([k, v]) => [k, v]));

describe("reading client files in any layout", () => {
  it("CSV with a title row, semicolons, quotes and Windows-1252 text", async () => {
    const csv = Buffer.from('ABC Traders - Lorry register\r\n"Party Name";"Address";Amount\r\n"Sri Ganesh; Co";"12, Main Rd ""East""";"1,500"\r\n\r\nCafé Rao;Erode;200\r\n', "latin1");
    const t = (await readAnyFile(file("a.csv", csv), "a.csv"))[0];
    expect(t.headers).toEqual(["Party Name", "Address", "Amount"]);
    expect(t.headerRow).toBe(2);
    expect(t.rows.map((r) => r.values)).toEqual([["Sri Ganesh; Co", '12, Main Rd "East"', "1,500"], ["Café Rao", "Erode", "200"]]);
    expect(t.rows.map((r) => r.rowNumber)).toEqual([3, 5]);
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    expect(splitDelimited('x,"a,b"', ",")).toEqual([["x", "a,b"]]);
  });
  it("JSON (nested objects are flattened) and Excel with title rows", async () => {
    const j = (await readAnyFile(file("c.json", JSON.stringify({ customers: [{ name: "A", contact: { mobile: "98" } }, { name: "B" }] })), "c.json"))[0];
    expect(j.headers).toEqual(["name", "contact.mobile"]);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Trips");
    ws.addRow(["G ROAD LINES TRIP REGISTER OCT 2026"]);
    ws.addRow([]);
    ws.addRow(["Date", "Party", "Lorry No"]);
    ws.addRow([new Date("2026-10-01T00:00:00Z"), "ABC", "TN 37 AB 1"]);
    await wb.xlsx.writeFile(path.join(dir, "t.xlsx"));
    const x = (await readAnyFile(path.join(dir, "t.xlsx"), "t.xlsx"))[0];
    expect(x.headers).toEqual(["Date", "Party", "Lorry No"]);
    expect(x.rows[0].rowNumber).toBe(4);
  });
  it("explains what to do with formats it cannot read", async () => {
    await expect(readAnyFile(file("old.xls", "x"), "old.xls")).rejects.toThrow(/Save As/);
    await expect(readAnyFile(file("scan.pdf", "x"), "scan.pdf")).rejects.toThrow(/cannot be imported/);
  });
  it("suggests mappings from the words transporters actually use", () => {
    const h = ["Sl No", "Date", "Party Name", "Lorry No", "From", "To", "Material", "Wt (MT)", "LR No", "Freight", "Lorry Hire", "Advance", "Hamali", "Diesel", "Toll", "Remarks"];
    const m = suggestMapping("trips", h);
    const by = Object.fromEntries(Object.entries(m).map(([c, f]) => [h[Number(c)], f]));
    expect(by["Sl No"]).toBeUndefined(); // a client's serial number is not a trip number
    expect(by).toMatchObject({ "Wt (MT)": "weightTons", Date: "tripDate", "Party Name": "customerId", "Lorry No": "vehicleId", From: "loadingPointId", To: "deliveryPointId", Material: "material", "LR No": "lrNumber", Freight: "customerFreight", "Lorry Hire": "transporterHire", Advance: "advance", Hamali: "loadingCharges", Diesel: "diesel", Toll: "toll", Remarks: "remarks" });
    const c = suggestMapping("customers", ["Party Name", "GST No", "Mobile No", "City", "Opening Bal"]);
    expect(Object.values(c)).toEqual(["name", "gstin", "mobile", "city", "openingBalance"]);
    expect(importFields("trips").find((f) => f.key === "customerId")?.required).toBe(true);
  });
});

describe("importing a client's own trip register", () => {
  beforeAll(async () => {
    await wipeAll();
    await seedBase({ adminPassword: "Admin@12345" });
    await saveMaster(adminCtx(), "customers", { name: "ABC Manufacturing", address: "Old address 12", city: "Coimbatore", creditDays: 45 });
    await saveMaster(adminCtx(), "vehicles", { vehicleNumber: "TN37AB1234" });
  });

  it("maps names to records, creates missing masters, cleans values, and reports errors on the client's row numbers", async () => {
    const csv = [
      "Trip register,,,,,,,,",
      "Date,Party Name,Lorry No,From,To,Lorry Owner,Freight,Lorry Hire,Advance,Status",
      '08-Oct-2026,abc manufacturing,TN 37 AB 1234,Coimbatore,Tiruppur,Sri Murugan Transports,"Rs. 30,000/-","22,000",10000,Delivered',
      "07/10/2026,New Party Pvt Ltd,tn-38-bc-9999,Erode,Chennai,Sri Murugan Transports,45500,38000,0,in transit",
      "not a date,ABC Manufacturing,TN37AB1234,Salem,Madurai,,12000,9000,,booked",
    ].join("\n");
    const p = file("register.csv", csv);
    const headers = (await readAnyFile(p, "register.csv"))[0].headers;
    const r = await prepareImport({ filePath: p, fileName: "register.csv", tableIndex: 0, target: "trips", mapping: mappingFor("trips", headers), createMissing: true, existing: "update" });
    expect(r.summary.rowsToImport).toBe(3);
    expect(r.summary.newMasters).toMatchObject({ Customers: ["New Party Pvt Ltd"], Vehicles: ["TN38BC9999"], Transporters: ["Sri Murugan Transports"] });
    expect(r.sheets).toContain("trips");
    const staged = stagedPath(r.token)!;
    const plan = await preview(staged.filePath, "IMPORT", r.sheets);
    // the bad date is reported on row 5, exactly where it is in the client's file
    expect(plan.issues).toEqual([expect.objectContaining({ sheet: "08_Trips", row: 5, field: "Trip Date" })]);
    const res = await runRestore({ filePath: staged.filePath, fileName: r.fileName, mode: "IMPORT", sheets: r.sheets, skipInvalid: true, userName: "Admin" });
    expect(res.ok, (res as any).message).toBe(true);
    const trips = await prisma.trip.findMany({ include: { customer: true, vehicle: true, transporter: true, loadingPoint: true, settlement: true }, orderBy: { tripDate: "desc" } });
    expect(trips).toHaveLength(2);
    const t1 = trips[0];
    expect(t1.customer.name).toBe("ABC Manufacturing"); // matched the existing customer, not duplicated
    expect(t1.vehicle?.vehicleNumber).toBe("TN37AB1234");
    expect(Number(t1.customerFreight)).toBe(30000);
    expect(t1.status).toBe("DELIVERED");
    expect(t1.tripNumber).toMatch(/^TRP-\d{6}$/);
    expect(t1.settlement?.code).toMatch(/^STL-/); // settlement created like a trip typed on screen
    expect(trips[1].status).toBe("IN TRANSIT");
    expect(await prisma.customer.count()).toBe(2);
    expect(await prisma.transporter.count()).toBe(1); // created once, used twice
  });

  it("updates existing records without blanking fields the file does not have", async () => {
    const p = file("customers.csv", "Party Name,Mobile No,Credit Days\nABC MANUFACTURING,+91 98430 12345,60\nFresh Customer,9000000001,15\n");
    const headers = (await readAnyFile(p, "customers.csv"))[0].headers;
    const r = await prepareImport({ filePath: p, fileName: "customers.csv", tableIndex: 0, target: "customers", mapping: mappingFor("customers", headers), createMissing: true, existing: "update" });
    expect(r.summary.matchedExisting).toBe(1);
    const res = await runRestore({ filePath: stagedPath(r.token)!.filePath, fileName: r.fileName, mode: "IMPORT", sheets: r.sheets, userName: "Admin" });
    expect(res.ok, (res as any).message).toBe(true);
    const abc = await prisma.customer.findFirst({ where: { name: "ABC Manufacturing" } });
    expect(abc?.mobile).toBe("9843012345");
    expect(abc?.creditDays).toBe(60);
    expect(abc?.address).toBe("Old address 12"); // kept
    expect(await prisma.customer.findFirst({ where: { name: "Fresh Customer" } })).toBeTruthy();
    expect(await prisma.customer.count()).toBe(3);
  });

  it("refuses to guess when a required column is not mapped", async () => {
    const p = file("x.csv", "Date,Amount\n01-10-2026,100\n");
    await expect(prepareImport({ filePath: p, fileName: "x.csv", tableIndex: 0, target: "trips", mapping: { 0: "tripDate" }, createMissing: true, existing: "update" })).rejects.toThrow(/Customer/);
  });
});

describe("exporting data", () => {
  it("writes every format", async () => {
    for (const f of EXPORT_FORMATS) {
      const out = await exportData("trips", f);
      expect(out.body.length, f).toBeGreaterThan(50);
      expect(out.fileName.endsWith(`.${f}`)).toBe(true);
    }
    const json = JSON.parse((await exportData("trips", "json")).body.toString());
    expect(json).toHaveLength(2);
    expect(typeof json[0].customerFreight).toBe("number");
    expect(json[0].customerName).toBeTruthy(); // names next to IDs
    const csv = (await exportData("customers", "csv")).body.toString();
    expect(csv.split("\r\n")).toHaveLength(4);
    expect((await exportData("trips", "pdf")).body.subarray(0, 4).toString()).toBe("%PDF");
    const xml = (await exportData("all", "xml")).body.toString();
    expect(xml).toContain("<trips>");
    expect(xml.match(/<record>/g)!.length).toBeGreaterThan(5);
    const all = JSON.parse((await exportData("all", "json")).body.toString());
    expect(Object.keys(all)).toEqual(expect.arrayContaining(["customers", "trips", "expenses", "auditLogs"]));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await exportData("all", "xlsx")).body);
    expect(wb.worksheets).toHaveLength(23);
    await expect(exportData("all", "pdf")).rejects.toThrow(/Excel, JSON or XML/);
  });
  it("filters by date", async () => {
    const json = JSON.parse((await exportData("trips", "json", { from: "2026-10-08", to: "2026-10-08" })).body.toString());
    expect(json).toHaveLength(1);
  });
});
