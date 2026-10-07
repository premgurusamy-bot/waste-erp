import { describe, expect, it } from "vitest";
import { numberToWords, rupeesInWords } from "@/lib/words";
import { customerSchema, gateInSchema, processingSchema, vehicleSchema } from "@/lib/validation";
import { AppError } from "@/server/errors";
import { computeTax, partyState, roundOffTotal, sumTaxes } from "@/server/gst";
import { ageBucket } from "@/server/reports";
import { convertWeight, lineAmount } from "@/server/services/billing";
import { pickMostSpecific } from "@/server/services/contracts";
import { expiryState } from "@/server/services/notifications";
import { checkProcessingBalance } from "@/server/services/processing";
import { paymentStatusFor } from "@/server/services/receipts";
import { calculateNetWeight } from "@/server/services/weighments";
import { dateOnly } from "@/lib/utils";

describe("Weighment net weight", () => {
  it("Gross 8,540 − Tare 5,100 = Net 3,440 KG", () => {
    expect(calculateNetWeight(8540, 5100)).toBe(3440);
  });
  it("handles decimals precisely", () => {
    expect(calculateNetWeight(1000.125, 400.1)).toBe(600.025);
  });
  it("rejects tare greater than or equal to gross", () => {
    expect(() => calculateNetWeight(5000, 5100)).toThrow(/Tare weight must be less than gross/);
    expect(() => calculateNetWeight(5000, 5000)).toThrow(AppError);
  });
  it("rejects negative or zero weights", () => {
    expect(() => calculateNetWeight(8540, -1)).toThrow(/cannot be negative/);
    expect(() => calculateNetWeight(0, 0)).toThrow(/greater than zero/);
  });
  it("gate-in schema rejects negative gross weight", () => {
    const r = gateInSchema.safeParse({ vehicleId: "v", customerId: "c", wasteTypeId: "w", locationId: "l", gateInAt: "2026-10-07T10:00", grossWeight: "-5" });
    expect(r.success).toBe(false);
  });
});

describe("Processing balance: INPUT = OUTPUT + REJECTED + LOSS", () => {
  it("accepts a balanced batch", () => {
    expect(() => checkProcessingBalance(1000, 700, 200, 100)).not.toThrow();
  });
  it("rejects an unexplained difference", () => {
    expect(() => checkProcessingBalance(1000, 700, 200, 50)).toThrow(/Unexplained difference: 50 KG/);
  });
  it("is exact to the gram", () => {
    expect(() => checkProcessingBalance(1000, 699.999, 200, 100)).toThrow(/0.001/);
  });
  it("schema requires at least one input", () => {
    expect(processingSchema.safeParse({ batchNo: "B1", date: "2026-10-07", locationId: "l", inputs: [] }).success).toBe(false);
  });
});

describe("Billing arithmetic", () => {
  it("weight based: quantity × rate", () => {
    expect(lineAmount(3440, 2.5)).toBe(8600);
  });
  it("trip based: trips × rate", () => {
    expect(lineAmount(12, 1500)).toBe(18000);
  });
  it("converts KG to tonnes for per-tonne rates", () => {
    expect(convertWeight(3440, "TONNE")).toBe(3.44);
    expect(lineAmount(convertWeight(3440, "TONNE"), 1800)).toBe(6192);
  });
  it("picks the most specific rate (site + waste type first)", () => {
    const rates = [
      { id: "general", siteId: null, wasteTypeId: null },
      { id: "waste", siteId: null, wasteTypeId: "W" },
      { id: "site", siteId: "S", wasteTypeId: null },
      { id: "both", siteId: "S", wasteTypeId: "W" },
    ];
    expect(pickMostSpecific(rates, "S", "W")?.id).toBe("both");
    expect(pickMostSpecific(rates, "S", "X")?.id).toBe("site");
    expect(pickMostSpecific(rates, "T", "W")?.id).toBe("waste");
    expect(pickMostSpecific(rates, "T", "X")?.id).toBe("general");
  });
});

describe("GST", () => {
  it("splits intra-state into CGST + SGST", () => {
    expect(computeTax(8600, 18, false)).toEqual({ taxableValue: 8600, gstRate: 18, cgst: 774, sgst: 774, igst: 0, total: 10148 });
  });
  it("applies IGST for inter-state", () => {
    expect(computeTax(8600, 18, true)).toEqual({ taxableValue: 8600, gstRate: 18, cgst: 0, sgst: 0, igst: 1548, total: 10148 });
  });
  it("charges nothing when GST is disabled", () => {
    expect(computeTax(1000, 18, false, false).total).toBe(1000);
  });
  it("rounds off totals", () => {
    const t = sumTaxes([computeTax(100.4, 5, false)]);
    expect(roundOffTotal(t.gross, true)).toEqual({ total: 105, roundOff: round(105 - t.gross) });
  });
  it("derives state from GSTIN", () => {
    expect(partyState("29AAACX9876F1Z4", "33")).toBe("29");
    expect(partyState(null, "33")).toBe("33");
  });
});

describe("Receivables", () => {
  it("payment status", () => {
    expect(paymentStatusFor(0, 100)).toBe("UNPAID");
    expect(paymentStatusFor(40, 100)).toBe("PARTIAL");
    expect(paymentStatusFor(100, 100)).toBe("PAID");
  });
  it("ageing buckets", () => {
    expect(ageBucket(0)).toBe("current");
    expect(ageBucket(1)).toBe("b30");
    expect(ageBucket(30)).toBe("b30");
    expect(ageBucket(31)).toBe("b60");
    expect(ageBucket(61)).toBe("b90");
    expect(ageBucket(91)).toBe("b90p");
  });
});

describe("Document expiry alerts", () => {
  const today = dateOnly("2026-10-07");
  it("classifies dates", () => {
    expect(expiryState(dateOnly("2026-10-01"), today)).toBe("EXPIRED");
    expect(expiryState(dateOnly("2026-10-20"), today)).toBe("EXPIRING_SOON");
    expect(expiryState(dateOnly("2027-10-20"), today)).toBe("ACTIVE");
    expect(expiryState(null, today)).toBe("NOT_SET");
  });
});

describe("Validation", () => {
  it("validates GSTIN format", () => {
    expect(customerSchema.safeParse({ name: "X", gstin: "33AAACA1234B1Z2" }).success).toBe(true);
    expect(customerSchema.safeParse({ name: "X", gstin: "BAD" }).success).toBe(false);
  });
  it("validates mobile numbers", () => {
    expect(customerSchema.safeParse({ name: "X", mobile: "98765 43210" }).success).toBe(true);
    expect(customerSchema.safeParse({ name: "X", mobile: "12345" }).success).toBe(false);
  });
  it("normalises vehicle numbers", () => {
    const r = vehicleSchema.parse({ number: "tn 37  ab 1234", type: "Tipper", capacityKg: "8000" });
    expect(r.number).toBe("TN 37 AB 1234");
    expect(vehicleSchema.safeParse({ number: "???", type: "Tipper", capacityKg: "8000" }).success).toBe(false);
  });
});

describe("Amount in words (Indian numbering)", () => {
  it("formats lakh and crore", () => {
    expect(numberToWords(24320)).toBe("Twenty Four Thousand Three Hundred Twenty");
    expect(numberToWords(177000)).toBe("One Lakh Seventy Seven Thousand");
    expect(numberToWords(12500000)).toBe("One Crore Twenty Five Lakh");
    expect(rupeesInWords(10.5)).toBe("Rupees Ten and Fifty Paise Only");
  });
});

function round(n: number) {
  return Math.round(n * 100) / 100;
}
