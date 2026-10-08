import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/server/db.js";
import { seedBase } from "../src/server/seed/seed.js";
import { saveMaster, findRate } from "../src/server/services/masters.js";
import { saveTrip, getTrip, cancelTrip, setTripStatus } from "../src/server/services/trips.js";
import { saveExpense } from "../src/server/services/expenses.js";
import { createInvoice, createReceipt, getInvoice, cancelInvoice, billableTrips } from "../src/server/services/billing.js";
import { listSettlements, createPayment, updateDeductions, getSettlement } from "../src/server/services/settlements.js";
import { profitSummary, saveTarget, targetStatus, receivables, payables } from "../src/server/services/analytics.js";
import { expiryList } from "../src/server/services/alerts.js";
import { runReport, REPORTS } from "../src/server/services/reports.js";
import { reportCsv, reportPdf, reportXlsx } from "../src/server/lib/export.js";
import { systemCtx } from "../src/server/context.js";
import { DEFAULT_ROLE_PERMISSIONS } from "../src/shared/permissions.js";
import { adminCtx, wipeAll } from "./helpers.js";
import { todayIst, addDays } from "../src/shared/calc.js";

const ctx = adminCtx();
const today = todayIst();
let customer: any, transporter: any, vehicle: any, driver: any, lp: any, dp: any, trip: any;

describe("transport operations", () => {
  beforeAll(async () => {
    await wipeAll();
    await seedBase({ adminPassword: "Admin@12345" });
  });

  it("creates customer, transporter, vehicle, driver and places with permanent IDs and codes", async () => {
    customer = await saveMaster(ctx, "customers", { name: "ABC Manufacturing", gstin: "33aaaca1234b1z5", mobile: "98430 12345", creditDays: 30 });
    transporter = await saveMaster(ctx, "transporters", { name: "Sri Murugan Transports", mobile: "9751012345" });
    vehicle = await saveMaster(ctx, "vehicles", { vehicleNumber: "tn 37 ab 1234", vehicleType: "10 Wheeler", transporterId: transporter.id, insuranceExpiry: addDays(today, 5), fcExpiry: addDays(today, -1) });
    driver = await saveMaster(ctx, "drivers", { name: "Murugan", licenseNumber: "TN37 20150001234", licenseExpiry: addDays(today, 20) });
    lp = await saveMaster(ctx, "loadingPoints", { name: "Coimbatore" });
    dp = await saveMaster(ctx, "deliveryPoints", { name: "Tiruppur" });
    expect(customer.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(customer.code).toBe("CUS-000001");
    expect(customer.gstin).toBe("33AAACA1234B1Z5");
    expect(vehicle.vehicleNumber).toBe("TN37AB1234");
    await expect(saveMaster(ctx, "vehicles", { vehicleNumber: "TN37AB1234" })).rejects.toThrow(/already exists/);
    await expect(saveMaster(ctx, "customers", { name: "X", gstin: "BAD" })).rejects.toThrow(/GSTIN/);
  });

  it("finds the freight rate card for a route", async () => {
    await saveMaster(ctx, "freightRates", { customerId: customer.id, loadingPointId: lp.id, deliveryPointId: dp.id, customerRate: 30000, transporterRate: 22000 });
    const r = await findRate(ctx, { customerId: customer.id, loadingPointId: lp.id, deliveryPointId: dp.id });
    expect(r?.customerRate).toBe(30000);
    expect(await findRate(ctx, { loadingPointId: dp.id })).toBeNull();
  });

  it("creates a trip, its transporter settlement, and calculates profit (Coimbatore -> Tiruppur: 30,000 - 22,000 - 3,000 = 5,000)", async () => {
    trip = await saveTrip(ctx, {
      tripDate: today, customerId: customer.id, transporterId: transporter.id, vehicleId: vehicle.id, driverId: driver.id, loadingPointId: lp.id, deliveryPointId: dp.id,
      material: "Cotton Yarn", weightTons: 12, distanceKm: 55, lrNumber: "LR1", customerFreight: 30000, transporterHire: 22000,
      loadingCharges: 800, unloadingCharges: 700, toll: 600, driverBata: 900, advance: 10000, items: [{ description: "Yarn bags", packages: 200 }],
    });
    expect(trip.tripNumber).toBe("TRP-000001");
    const t = await getTrip(ctx, trip.id);
    expect(t.profitDetail.profit).toBe(5000);
    expect(t.profitDetail.totalCost).toBe(25000);
    expect(t.items).toHaveLength(1);
    expect(t.settlement.code).toBe("STL-000001");
    await expect(saveTrip(ctx, { tripDate: today, customerId: customer.id, transporterHire: 100, advance: 200 })).rejects.toThrow(/Advance cannot be more/);
  });

  it("includes expense entries linked to the trip in its profit", async () => {
    await saveExpense(ctx, { expenseDate: today, category: "DIESEL", amount: 1000, tripId: trip.id, paymentStatus: "UNPAID" });
    const t = await getTrip(ctx, trip.id);
    expect(t.profitDetail.linkedExpenses).toBe(1000);
    expect(t.profitDetail.profit).toBe(4000);
    expect(t.expenses[0].vehicleId).toBe(vehicle.id); // filled from the trip
    await saveExpense(ctx, { expenseDate: today, category: "OFFICE", amount: 500 });
    const p = await profitSummary(today, today);
    expect(p.revenue).toBe(30000);
    expect(p.tripCost).toBe(25000);
    expect(p.linkedExpenses).toBe(1000);
    expect(p.otherExpenses).toBe(500);
    expect(p.netProfit).toBe(3500);
    expect(p.profitPerKm).toBe(63.64);
  });

  it("bills the trip (GST as chosen), records receipt and keeps receivable correct", async () => {
    await setTripStatus(ctx, trip.id, { status: "POD RECEIVED", date: today });
    expect((await billableTrips(ctx, customer.id)).map((x: any) => x.id)).toEqual([trip.id]);
    const inv = await createInvoice(ctx, { customerId: customer.id, invoiceDate: today, tripIds: [trip.id], otherCharges: 0, gstType: "CGST_SGST", gstRate: 12 });
    expect(inv.invoiceNumber).toMatch(/^GRL\/\d{4}-\d{2}\/0001$/);
    expect(inv.cgst).toBe(1800);
    expect(inv.total).toBe(33600);
    expect((await getTrip(ctx, trip.id)).status).toBe("BILLED");
    await expect(createInvoice(ctx, { customerId: customer.id, invoiceDate: today, tripIds: [trip.id], otherCharges: 0, gstType: "NONE", gstRate: 0 })).rejects.toThrow(/already billed/);
    await expect(saveTrip(ctx, { ...(await getTrip(ctx, trip.id)), customerFreight: 1 }, trip.id)).rejects.toThrow(/billed/);
    await expect(createReceipt(ctx, { customerId: customer.id, invoiceId: inv.id, receiptDate: today, amount: 40000 })).rejects.toThrow(/more than the invoice balance/);
    await createReceipt(ctx, { customerId: customer.id, invoiceId: inv.id, receiptDate: today, amount: 20000, tdsAmount: 600 });
    const i = await getInvoice(ctx, inv.id);
    expect(i.received).toBe(20600);
    expect(i.balance).toBe(13000);
    expect(i.payState).toBe("PARTIAL");
    const rec = await receivables(ctx);
    expect(rec.totals.total).toBe(13000);
    expect(rec.totals["0-30"]).toBe(13000);
    await expect(cancelInvoice(ctx, inv.id, "wrong")).rejects.toThrow(/receipts/);
  });

  it("settles the transporter: hire - advance - deductions - payments", async () => {
    const s = (await listSettlements(ctx, {})).rows[0] as any;
    expect(s.balance).toBe(12000);
    await updateDeductions(ctx, s.id, { deductions: 500, deductionNote: "Shortage" });
    await expect(createPayment(ctx, { transporterId: transporter.id, settlementId: s.id, paymentDate: today, amount: 20000 })).rejects.toThrow(/more than the settlement balance/);
    await createPayment(ctx, { transporterId: transporter.id, settlementId: s.id, paymentDate: today, amount: 11500, mode: "NEFT", reference: "UTR1" });
    const after = await getSettlement(ctx, s.id);
    expect(after.balance).toBe(0);
    expect(after.status).toBe("PAID");
    expect((await getTrip(ctx, trip.id)).status).toBe("SETTLED");
    const pay = await payables(ctx);
    expect(pay.transporter.total).toBe(0);
    expect(pay.driver.total).toBe(1000); // unpaid diesel expense linked to the trip's driver
  });

  it("cancels a trip only when it is not billed", async () => {
    const t2 = await saveTrip(ctx, { tripDate: today, customerId: customer.id, transporterId: transporter.id, customerFreight: 5000, transporterHire: 4000 });
    await expect(cancelTrip(ctx, t2.id, "")).rejects.toThrow(/reason/);
    await cancelTrip(ctx, t2.id, "Customer cancelled order");
    const c = await getTrip(ctx, t2.id);
    expect(c.status).toBe("CANCELLED");
    expect(c.settlement.status).toBe("CANCELLED");
    await expect(cancelTrip(ctx, trip.id, "late")).rejects.toThrow(/billed/);
  });

  it("calculates the target meter from real profit", async () => {
    await saveTarget(ctx, { period: "MONTHLY", metric: "PROFIT", amount: 100000 });
    const t = await targetStatus("MONTHLY", today);
    expect(t.meter?.achieved).toBe((await profitSummary(t.range.start, today)).netProfit);
    expect(t.meter?.target).toBe(100000);
    expect(["ON TRACK", "AT RISK", "BEHIND TARGET", "TARGET ACHIEVED"]).toContain(t.meter?.status);
  });

  it("lists expiries at the right alert levels", async () => {
    const e = await expiryList(today, 60);
    expect(e.find((x) => x.document === "FC")?.level).toBe("EXPIRED");
    expect(e.find((x) => x.document === "Insurance")?.level).toBe("7 DAYS");
    expect(e.find((x) => x.document === "Driver License")?.level).toBe("30 DAYS");
  });

  it("runs every report and exports it to Excel, CSV and PDF", async () => {
    for (const r of REPORTS) {
      const out = await runReport(ctx, r.key, {});
      expect(out.columns.length, r.key).toBeGreaterThan(0);
      expect((await reportXlsx(out, "G Road Lines")).subarray(0, 2).toString()).toBe("PK");
      expect(reportCsv(out).split("\n").length).toBeGreaterThan(0);
      expect((await reportPdf(out, "G Road Lines")).subarray(0, 4).toString()).toBe("%PDF");
    }
    expect(REPORTS).toHaveLength(16);
  });

  it("enforces role permissions in the service layer", async () => {
    const viewer = systemCtx(DEFAULT_ROLE_PERMISSIONS.VIEWER, "Viewer");
    await expect(saveTrip(viewer, { tripDate: today, customerId: customer.id })).rejects.toThrow(/permission/);
    await expect(createInvoice(viewer, {})).rejects.toThrow(/permission/);
    const ops = systemCtx(DEFAULT_ROLE_PERMISSIONS.OPERATIONS, "Ops");
    expect((await saveTrip(ops, { tripDate: today, customerId: customer.id })).tripNumber).toMatch(/^TRP-/);
    await expect(createPayment(ops, {})).rejects.toThrow(/permission/);
  });

  it("writes an audit trail with old and new values", async () => {
    await saveMaster(ctx, "customers", { name: "ABC Manufacturing Ltd", creditDays: 45 }, customer.id);
    const log = await prisma.auditLog.findFirst({ where: { entityId: customer.id, action: "EDIT" } });
    expect(log?.oldValue).toMatchObject({ name: "ABC Manufacturing", creditDays: 30 });
    expect(log?.newValue).toMatchObject({ name: "ABC Manufacturing Ltd", creditDays: 45 });
    expect(await prisma.auditLog.count({ where: { action: "INVOICE" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "PAYMENT" } })).toBe(2);
  });
});
