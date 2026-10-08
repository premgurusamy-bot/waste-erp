import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { SHEETS, INSERT_ORDER } from "../src/server/backup/sheets.js";

describe("Excel backup layout", () => {
  it("has the 23 required sheets in the specified order", () => {
    expect(SHEETS.map((s) => s.name)).toEqual([
      "01_Company", "02_Customers", "03_Transporters", "04_Vehicles", "05_Drivers", "06_LoadingPoints", "07_DeliveryPoints", "08_Trips", "09_TripItems", "10_Freight",
      "11_Expenses", "12_CustomerInvoices", "13_InvoiceItems", "14_CustomerReceipts", "15_TransporterSettlements", "16_TransporterPayments", "17_Documents",
      "18_VehicleDocuments", "19_DriverDocuments", "20_Targets", "21_Notifications", "22_AuditLogs", "23_Settings",
    ]);
    expect(new Set(INSERT_ORDER).size).toBe(SHEETS.length);
  });
  it("backs up EVERY database column of every business table (no field is silently left out)", () => {
    for (const def of SHEETS) {
      const model = Prisma.dmmf.datamodel.models.find((m) => m.name.toLowerCase() === def.model.toLowerCase())!;
      const dbFields = model.fields.filter((f) => f.kind !== "object").map((f) => f.name).sort();
      const sheetFields = def.columns.filter((c) => !c.derived).map((c) => c.key).sort();
      expect(sheetFields, def.name).toEqual(dbFields);
    }
  });
  it("references always point to sheets restored earlier", () => {
    for (const def of SHEETS) for (const c of def.columns) if (c.ref) expect(INSERT_ORDER.indexOf(c.ref), `${def.name}.${c.key}`).toBeLessThan(INSERT_ORDER.indexOf(def.key));
  });
});
