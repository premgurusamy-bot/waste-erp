import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ROLE_DEFINITIONS } from "@/lib/permissions";
import { num, round2 } from "@/lib/utils";
import type { Ctx } from "@/server/context";
import { createCustomerInvoice, cancelCustomerInvoice, previewBilling } from "@/server/services/billing";
import { addRate, createContract, reviseRate } from "@/server/services/contracts";
import { trialBalance } from "@/server/services/ledger";
import { createEntity } from "@/server/services/masters";
import { createCollection } from "@/server/services/operations";
import { createProcessingBatch, cancelProcessingBatch } from "@/server/services/processing";
import { cancelReceipt, createReceipt } from "@/server/services/receipts";
import { createSalesInvoice } from "@/server/services/sales";
import { recordStockMovement } from "@/server/services/inventory";
import { createUser } from "@/server/services/users";
import { gateIn, gateOut } from "@/server/services/weighments";
import { outstandingByCustomer } from "@/server/reports";
import { at, ctxFor, fixture, ids, today, uniq, weightContract } from "../helpers";

let admin: Ctx;
beforeAll(async () => {
  admin = await ctxFor("ADMIN");
});

/** Weigh `net` KG for a fixture customer on a date. */
async function weigh(f: Awaited<ReturnType<typeof fixture>>, date: string, gross: number, tare: number) {
  const w = await gateIn(admin, { vehicleId: f.vehicle.id, customerId: f.customer.id, siteId: f.site.id, wasteTypeId: f.I.wasteType("DRY"), locationId: f.I.location("YARD-1"), gateInAt: at(date, "09:00"), grossWeight: gross });
  return gateOut(admin, { weighmentId: w.id, tareWeight: tare, gateOutAt: at(date, "09:40") });
}

const stockOf = async (code: string, loc: string) => {
  const it = await prisma.inventoryItem.findUniqueOrThrow({ where: { code } });
  return num((await prisma.inventoryBalance.findUnique({ where: { itemId_locationId: { itemId: it.id, locationId: loc } } }))?.quantity);
};

describe("Processing", () => {
  it("posts a balanced batch: input issued, recovered material and rejects received", async () => {
    const I = await ids();
    const yard = I.location("YARD-1");
    const item = async (c: string) => (await prisma.inventoryItem.findUniqueOrThrow({ where: { code: c } })).id;
    await recordStockMovement(admin, { kind: "OPENING", date: today(), itemId: await item("RAW-PAPER"), locationId: yard, quantity: 1000, remarks: "test opening" });
    const [rawBefore, paperBefore, rejBefore] = [await stockOf("RAW-PAPER", yard), await stockOf("RCV-PAPER", yard), await stockOf("REJECT", yard)];
    const proc = await ctxFor("PROCESSING");
    const b = await createProcessingBatch(proc, {
      batchNo: uniq("B"), date: today(), locationId: yard,
      inputs: [{ itemId: await item("RAW-PAPER"), quantity: 1000 }],
      outputs: [{ itemId: await item("RCV-PAPER"), quantity: 700 }],
      rejectedQty: 200, lossQty: 100,
    });
    expect(b.number).toMatch(/^PROC-\d{5}$/);
    expect(await stockOf("RAW-PAPER", yard)).toBe(rawBefore - 1000);
    expect(await stockOf("RCV-PAPER", yard)).toBe(paperBefore + 700);
    expect(await stockOf("REJECT", yard)).toBe(rejBefore + 200);

    await cancelProcessingBatch(admin, b.id, "Entered twice");
    expect(await stockOf("RAW-PAPER", yard)).toBe(rawBefore);
  });

  it("rejects INPUT ≠ OUTPUT + REJECTED + LOSS", async () => {
    const I = await ids();
    const raw = await prisma.inventoryItem.findUniqueOrThrow({ where: { code: "RAW-PAPER" } });
    const out = await prisma.inventoryItem.findUniqueOrThrow({ where: { code: "RCV-PAPER" } });
    await expect(
      createProcessingBatch(admin, { batchNo: "X", date: today(), locationId: I.location("YARD-1"), inputs: [{ itemId: raw.id, quantity: 1000 }], outputs: [{ itemId: out.id, quantity: 700 }], rejectedQty: 200, lossQty: 50 }),
    ).rejects.toThrow(/Unexplained difference: 50 KG/);
  });

  it("cannot process more than the available stock", async () => {
    const I = await ids();
    const raw = await prisma.inventoryItem.findUniqueOrThrow({ where: { code: "RAW-GLASS" } });
    const out = await prisma.inventoryItem.findUniqueOrThrow({ where: { code: "RCV-GLASS" } });
    const have = await stockOf("RAW-GLASS", I.location("MRF-1"));
    await expect(
      createProcessingBatch(admin, { batchNo: "X", date: today(), locationId: I.location("MRF-1"), inputs: [{ itemId: raw.id, quantity: have + 500 }], outputs: [{ itemId: out.id, quantity: have + 500 }] }),
    ).rejects.toThrow(/Insufficient stock/);
  });
});

describe("Recyclable sales and inventory", () => {
  it("a sale cannot exceed stock, and nothing is saved when it fails (atomic rollback)", async () => {
    const I = await ids();
    const store = I.location("STORE-1");
    const buyer = await createEntity(admin, "buyer", { name: uniq("Buyer"), gstin: "33AAAFR1111A1Z3", paymentTermsDays: 15 });
    const metal = await prisma.inventoryItem.findUniqueOrThrow({ where: { code: "RCV-METAL" } });
    const before = await stockOf("RCV-METAL", store);
    const [salesBefore, journalsBefore] = [await prisma.salesInvoice.count(), await prisma.journalEntry.count()];
    const sales = await ctxFor("SALES");
    await expect(createSalesInvoice(sales, { date: today(), buyerId: buyer.id, locationId: store, items: [{ itemId: metal.id, quantity: before + 100, rate: 30 }] })).rejects.toThrow(/Insufficient stock/);
    expect(await prisma.salesInvoice.count()).toBe(salesBefore);
    expect(await prisma.journalEntry.count()).toBe(journalsBefore);
    expect(await stockOf("RCV-METAL", store)).toBe(before);
  });

  it("a valid sale creates the invoice, reduces stock and posts accounts together", async () => {
    const I = await ids();
    const store = I.location("STORE-1");
    const metal = await prisma.inventoryItem.findUniqueOrThrow({ where: { code: "RCV-METAL" } });
    await recordStockMovement(admin, { kind: "OPENING", date: today(), itemId: metal.id, locationId: store, quantity: 500, remarks: "test" });
    const before = await stockOf("RCV-METAL", store);
    const buyer = await createEntity(admin, "buyer", { name: uniq("Buyer"), gstin: "32AAACA3333C1Z1", paymentTermsDays: 15 }); // Kerala → IGST
    const s = await createSalesInvoice(admin, { date: today(), buyerId: buyer.id, locationId: store, items: [{ itemId: metal.id, quantity: 200, rate: 32 }] });
    expect(s.number).toMatch(/^SALE-\d{4}-\d{5}$/);
    expect(num(s.subtotal)).toBe(6400);
    expect(num(s.igst)).toBe(1152);
    expect(num(s.cgst)).toBe(0);
    expect(num(s.total)).toBe(7552);
    expect(await stockOf("RCV-METAL", store)).toBe(before - 200);
    const je = await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: "SALES_INVOICE", sourceId: s.id }, include: { lines: true } });
    expect(round2(je.lines.reduce((a, l) => a + num(l.debit), 0))).toBe(7552);
    expect(round2(je.lines.reduce((a, l) => a + num(l.credit), 0))).toBe(7552);
  });

  it("negative stock needs an explicit admin override", async () => {
    const I = await ids();
    const item = await prisma.inventoryItem.findUniqueOrThrow({ where: { code: "RCV-COMPOST" } });
    const loc = I.location("STORE-1");
    const have = await stockOf("RCV-COMPOST", loc);
    const weigh = await ctxFor("WEIGHBRIDGE");
    await expect(recordStockMovement(weigh, { kind: "ADJUSTMENT", date: today(), itemId: item.id, locationId: loc, quantity: -(have + 10), remarks: "count" })).rejects.toThrow(/Insufficient stock/);
    await expect(recordStockMovement(weigh, { kind: "ADJUSTMENT", date: today(), itemId: item.id, locationId: loc, quantity: -(have + 10), remarks: "count", allowNegative: true })).rejects.toThrow(/permission/);
    await recordStockMovement(admin, { kind: "ADJUSTMENT", date: today(), itemId: item.id, locationId: loc, quantity: -(have + 10), remarks: "admin approved", allowNegative: true });
    expect(await stockOf("RCV-COMPOST", loc)).toBe(-10);
    await recordStockMovement(admin, { kind: "ADJUSTMENT", date: today(), itemId: item.id, locationId: loc, quantity: 10 + have, remarks: "restore" });
  });
});

describe("Customer billing", () => {
  it("weight based: Quantity × Rate with CGST + SGST, and weighments cannot be billed twice", async () => {
    const f = await fixture(admin, { gstin: "33AAACT1234C1Z5" });
    await weightContract(admin, f.customer.id, 2.5, "KG", "2026-01-01");
    await weigh(f, "2026-09-10", 8540, 5100); // 3440
    await weigh(f, "2026-09-20", 7000, 5000); // 2000
    const acc = await ctxFor("ACCOUNTS");
    const inv = await createCustomerInvoice(acc, { customerId: f.customer.id, date: "2026-10-01", periodFrom: "2026-09-01", periodTo: "2026-09-30" });
    const items = await prisma.customerInvoiceItem.findMany({ where: { invoiceId: inv.id } });
    expect(items).toHaveLength(1);
    expect(num(items[0].quantity)).toBe(5440);
    expect(num(items[0].rate)).toBe(2.5);
    expect(num(items[0].taxableValue)).toBe(13600); // 5,440 × 2.50
    expect(num(inv.cgst)).toBe(1224);
    expect(num(inv.sgst)).toBe(1224);
    expect(num(inv.total)).toBe(16048);
    expect(inv.number).toMatch(/^INV-2026-\d{5}$/);
    // Nothing left to bill for the same period
    await expect(createCustomerInvoice(acc, { customerId: f.customer.id, date: "2026-10-01", periodFrom: "2026-09-01", periodTo: "2026-09-30" })).rejects.toThrow(/nothing to bill/);
    // Cancelling releases the weighments for billing again
    await cancelCustomerInvoice(acc, inv.id, "Wrong period");
    const again = await previewBilling(prisma, { customerId: f.customer.id, periodFrom: "2026-09-01", periodTo: "2026-09-30" });
    expect(again.lines[0].weighmentIds).toHaveLength(2);
  });

  it("uses the rate version effective on each transaction date", async () => {
    const f = await fixture(admin);
    const { rate } = await weightContract(admin, f.customer.id, 2.0, "KG", "2026-01-01");
    await reviseRate(admin, { rateId: rate.id, rate: 3.0, effectiveFrom: "2026-09-15" });
    await weigh(f, "2026-09-10", 6000, 5000); // 1000 kg @ 2.00
    await weigh(f, "2026-09-20", 6500, 5000); // 1500 kg @ 3.00
    const p = await previewBilling(prisma, { customerId: f.customer.id, periodFrom: "2026-09-01", periodTo: "2026-09-30" });
    const byRate = Object.fromEntries(p.lines.map((l) => [l.rate, l.quantity]));
    expect(byRate).toEqual({ 2: 1000, 3: 1500 });
  });

  it("trip based: Trips × Rate, and monthly: contract amount", async () => {
    const f = await fixture(admin);
    const I = f.I;
    const c = await createContract(admin, { customerId: f.customer.id, title: "Trips + monthly", startDate: "2026-01-01", status: "ACTIVE" });
    await addRate(admin, { contractId: c.id, billingMethod: "TRIP", rate: 1500, unit: "TRIP", taxTreatment: "TAXABLE", gstRateId: I.gst18, effectiveFrom: "2026-01-01" });
    await addRate(admin, { contractId: c.id, billingMethod: "MONTHLY", rate: 50000, unit: "MONTH", taxTreatment: "TAXABLE", gstRateId: I.gst18, effectiveFrom: "2026-01-01" });
    for (const d of ["2026-08-03", "2026-08-10", "2026-08-17"]) {
      await createCollection(admin, { customerId: f.customer.id, siteId: f.site.id, vehicleId: f.vehicle.id, wasteTypeId: I.wasteType("DRY"), collectionDate: at(d), actualQty: 800, status: "COMPLETED" });
    }
    const inv = await createCustomerInvoice(admin, { customerId: f.customer.id, date: "2026-09-01", periodFrom: "2026-08-01", periodTo: "2026-08-31" });
    const items = await prisma.customerInvoiceItem.findMany({ where: { invoiceId: inv.id }, orderBy: { billingMethod: "asc" } });
    const trip = items.find((i) => i.billingMethod === "TRIP")!;
    const monthly = items.find((i) => i.billingMethod === "MONTHLY")!;
    expect(num(trip.quantity)).toBe(3);
    expect(num(trip.taxableValue)).toBe(4500); // 3 trips × 1,500
    expect(num(monthly.quantity)).toBe(1);
    expect(num(monthly.taxableValue)).toBe(50000);
    // Monthly charge is not billed twice for the same month
    const p = await previewBilling(prisma, { customerId: f.customer.id, periodFrom: "2026-08-01", periodTo: "2026-08-31" });
    expect(p.lines).toHaveLength(0);
    expect(p.warnings.join(" ")).toMatch(/already billed/);
  });
});

describe("Payments and outstanding", () => {
  it("a receipt reduces the invoice balance and customer outstanding; cancelling restores it", async () => {
    const f = await fixture(admin, { gstin: "33AAACP1234D1Z2" });
    await weightContract(admin, f.customer.id, 2.5);
    await weigh(f, "2026-09-05", 8540, 5100);
    const inv = await createCustomerInvoice(admin, { customerId: f.customer.id, date: "2026-10-01", periodFrom: "2026-09-01", periodTo: "2026-09-30" });
    const total = num(inv.total);
    const out = async () => (await outstandingByCustomer("2026-12-31", f.customer.id))[0]?.balance ?? 0;
    expect(await out()).toBe(total);

    const I = await ids();
    const acc = await ctxFor("ACCOUNTS");
    const r1 = await createReceipt(acc, { date: "2026-10-05", partyType: "CUSTOMER", customerId: f.customer.id, amount: 4000, mode: "BANK_TRANSFER", accountId: I.account("1010"), reference: "UTR1", allocations: [{ invoiceId: inv.id, amount: 4000 }] });
    expect(r1.number).toMatch(/^RCPT-\d{5}$/);
    let fresh = await prisma.customerInvoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(fresh.paymentStatus).toBe("PARTIAL");
    expect(await out()).toBe(round2(total - 4000));

    await createReceipt(acc, { date: "2026-10-06", partyType: "CUSTOMER", customerId: f.customer.id, amount: total - 4000, mode: "UPI", accountId: I.account("1010"), allocations: [{ invoiceId: inv.id, amount: round2(total - 4000) }] });
    fresh = await prisma.customerInvoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(fresh.paymentStatus).toBe("PAID");
    expect(await out()).toBe(0);

    await cancelReceipt(acc, r1.id, "Cheque bounced");
    fresh = await prisma.customerInvoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(fresh.paymentStatus).toBe("PARTIAL");
    expect(await out()).toBe(4000);
  });

  it("cannot allocate more than the invoice balance", async () => {
    const f = await fixture(admin);
    await weightContract(admin, f.customer.id, 1);
    await weigh(f, "2026-09-05", 6000, 5000);
    const inv = await createCustomerInvoice(admin, { customerId: f.customer.id, date: "2026-10-01", periodFrom: "2026-09-01", periodTo: "2026-09-30" });
    const I = await ids();
    await expect(createReceipt(admin, { date: "2026-10-05", partyType: "CUSTOMER", customerId: f.customer.id, amount: 99999, mode: "CASH", accountId: I.account("1000"), allocations: [{ invoiceId: inv.id, amount: 99999 }] })).rejects.toThrow(/exceeds the balance/);
  });
});

describe("Permissions", () => {
  it("users cannot perform actions outside their role", async () => {
    const ops = await ctxFor("OPERATIONS");
    const weigh = await ctxFor("WEIGHBRIDGE");
    const proc = await ctxFor("PROCESSING");
    const mgmt = await ctxFor("MANAGEMENT");
    const f = await fixture(admin);
    await expect(createCustomerInvoice(ops, { customerId: f.customer.id, date: "2026-10-01", periodFrom: "2026-09-01", periodTo: "2026-09-30" })).rejects.toThrow(/permission/);
    await expect(createReceipt(weigh, { date: "2026-10-01", partyType: "CUSTOMER", customerId: f.customer.id, amount: 1, mode: "CASH", accountId: "x" })).rejects.toThrow(/permission/);
    await expect(createEntity(proc, "customer", { name: "Nope" })).rejects.toThrow(/permission/);
    await expect(gateIn(ops, {})).rejects.toThrow(/permission/);
    await expect(createUser(mgmt, { username: "x", name: "x", password: "Abcdefg1", roleIds: ["r"] })).rejects.toThrow(/permission/);
  });

  it("role definitions keep financial modules away from field roles", () => {
    const perms = (r: string) => ROLE_DEFINITIONS.find((x) => x.code === r)!.permissions;
    expect(perms("OPERATIONS")).not.toContain("billing.view");
    expect(perms("WEIGHBRIDGE")).not.toContain("weighments.override");
    expect(perms("MANAGEMENT").some((p) => p.endsWith(".manage"))).toBe(false);
    expect(perms("ACCOUNTS")).toContain("gst.manage");
  });
});

describe("Accounts", () => {
  it("every posting keeps the trial balance balanced", async () => {
    const tb = await trialBalance("2099-12-31");
    const dr = round2(tb.reduce((s, r) => s + r.debit, 0));
    const cr = round2(tb.reduce((s, r) => s + r.credit, 0));
    expect(dr).toBe(cr);
    expect(dr).toBeGreaterThan(0);
  });
});
