import { describe, it, expect } from "vitest";
import { tripProfit, targetMeter, computeGst, financialYear, periodRange, ageingBucket, expiryLevel, backupAgeLevel } from "../src/shared/calc.js";

describe("profit / loss", () => {
  it("calculates the sample trip: freight 30,000 - hire 22,000 - expenses 3,000 = 5,000", () => {
    const p = tripProfit({ customerFreight: 30000, transporterHire: 22000, loadingCharges: 800, unloadingCharges: 700, diesel: 0, toll: 600, rto: 0, driverBata: 900, otherExpense: 0, distanceKm: 55, advance: 10000 });
    expect(p.totalCost).toBe(25000);
    expect(p.profit).toBe(5000);
    expect(p.profitPct).toBe(16.67);
    expect(p.revenuePerKm).toBe(545.45);
    expect(p.costPerKm).toBe(454.55);
    expect(p.profitPerKm).toBe(90.91);
    expect(p.hireBalance).toBe(12000);
    expect(p.formula).toContain("= 5000");
  });
  it("shows a loss as negative profit and includes linked expense entries", () => {
    const p = tripProfit({ customerFreight: 10000, transporterHire: 9000, loadingCharges: 0, unloadingCharges: 0, diesel: 0, toll: 500, rto: 0, driverBata: 0, otherExpense: 0 }, 1000);
    expect(p.profit).toBe(-500);
    expect(p.revenuePerKm).toBeNull();
  });
});

describe("target meter", () => {
  it("reproduces the specification example (5,00,000 target, 3,25,000 achieved, 12 days left)", () => {
    // 30-day month, 18 days elapsed, 12 remaining
    const m = targetMeter({ target: 500000, achieved: 325000, start: "2026-09-01", end: "2026-09-30", today: "2026-09-18" });
    expect(m.remaining).toBe(175000);
    expect(m.achievementPct).toBe(65);
    expect(m.daysRemaining).toBe(12);
    expect(m.requiredDaily).toBe(14583.33);
    expect(m.currentDailyAverage).toBe(18055.56);
    expect(m.projected).toBe(541666.67);
    expect(m.status).toBe("ON TRACK");
  });
  it("classifies AT RISK, BEHIND TARGET and TARGET ACHIEVED", () => {
    const base = { target: 300000, start: "2026-09-01", end: "2026-09-30", today: "2026-09-15" };
    expect(targetMeter({ ...base, achieved: 135000 }).status).toBe("AT RISK"); // projected 270,000 = 90%
    expect(targetMeter({ ...base, achieved: 100000 }).status).toBe("BEHIND TARGET"); // projected 200,000
    expect(targetMeter({ ...base, achieved: 300000 }).status).toBe("TARGET ACHIEVED");
  });
});

describe("GST (never assumed)", () => {
  it("NONE adds nothing; CGST+SGST splits; IGST full; RCM adds nothing", () => {
    expect(computeGst(10000, "NONE", 12).total).toBe(10000);
    expect(computeGst(10000, "CGST_SGST", 12)).toMatchObject({ cgst: 600, sgst: 600, igst: 0, total: 11200 });
    expect(computeGst(10000, "IGST", 5)).toMatchObject({ igst: 500, total: 10500 });
    expect(computeGst(10000, "RCM", 5)).toMatchObject({ cgst: 0, igst: 0, total: 10000 });
    expect(computeGst(1001.5, "IGST", 12)).toMatchObject({ igst: 120.18, total: 1122, roundOff: 0.32 });
  });
});

describe("dates", () => {
  it("uses the Indian financial year (1 April - 31 March)", () => {
    expect(financialYear("2026-10-08")).toEqual({ label: "2026-27", start: "2026-04-01", end: "2027-03-31" });
    expect(financialYear("2027-03-31").label).toBe("2026-27");
    expect(financialYear("2027-04-01").label).toBe("2027-28");
    expect(periodRange("WEEKLY", "2026-10-08")).toEqual({ start: "2026-10-05", end: "2026-10-11" });
    expect(periodRange("MONTHLY", "2026-02-10")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });
  it("ageing, expiry and backup reminder levels", () => {
    expect([ageingBucket(0), ageingBucket(30), ageingBucket(31), ageingBucket(61), ageingBucket(91)]).toEqual(["0-30", "0-30", "31-60", "61-90", "90+"]);
    expect([expiryLevel(-1), expiryLevel(7), expiryLevel(15), expiryLevel(30), expiryLevel(60), expiryLevel(61)]).toEqual(["EXPIRED", "7 DAYS", "15 DAYS", "30 DAYS", "60 DAYS", null]);
    expect([backupAgeLevel(2), backupAgeLevel(25), backupAgeLevel(49), backupAgeLevel(24 * 7), backupAgeLevel(null)]).toEqual(["OK", "WARNING", "URGENT", "CRITICAL", "CRITICAL"]);
  });
});
