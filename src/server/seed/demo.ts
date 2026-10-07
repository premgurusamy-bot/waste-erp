/* DEMO DATA - clearly marked, generated through the real business services so that
   stock ledgers, journals and audit entries are all consistent. */
import type { PrismaClient } from "@prisma/client";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { addDays, dateOnly, round3, todayISO, toISODate } from "@/lib/utils";
import type { Ctx } from "../context";
import { createEntity } from "../services/masters";
import { addRate, createContract, reviseRate } from "../services/contracts";
import { assignSchedule, createCollection, createPickup, createSchedule, generateDailySchedules, startSchedule } from "../services/operations";
import { gateIn, gateOut } from "../services/weighments";
import { createProcessingBatch } from "../services/processing";
import { recordStockMovement } from "../services/inventory";
import { createSalesInvoice } from "../services/sales";
import { createCustomerInvoice } from "../services/billing";
import { createPayment, createReceipt } from "../services/receipts";
import { createExpense, createFuelEntry, createMaintenanceEntry, createPurchase } from "../services/purchases";
import { refreshNotifications } from "../services/notifications";

const DEMO = "DEMO DATA";

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seedDemo(prisma: PrismaClient, log: (m: string) => void = console.log) {
  if (await prisma.customer.count({ where: { isDemo: true } })) {
    log("Demo data already present - skipping.");
    return;
  }
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
  const ctx: Ctx = { userId: admin.id, username: "admin", permissions: new Set(ALL_PERMISSIONS), ip: "seed" };
  const rand = rng(20261007);
  const today = todayISO();
  const T = dateOnly(today);
  const day = (offset: number) => toISODate(addDays(T, offset));
  const at = (offset: number, hhmm: string) => `${day(offset)}T${hhmm}`;

  const wt = new Map((await prisma.wasteType.findMany()).map((w) => [w.code, w.id]));
  const item = new Map((await prisma.inventoryItem.findMany()).map((i) => [i.code, i.id]));
  const gst = new Map((await prisma.gstRate.findMany()).map((g) => [g.name, g.id]));
  const loc = new Map((await prisma.location.findMany()).map((l) => [l.code, l.id]));
  const acc = new Map((await prisma.ledgerAccount.findMany()).map((a) => [a.code, a.id]));
  const cat = new Map((await prisma.expenseCategory.findMany()).map((c) => [c.code, c.id]));
  const YARD = loc.get("YARD-1")!;

  log("Masters...");
  const customerDefs = [
    { name: "ABC Industries", gstin: "33AAACA1234B1Z2", contactPerson: "Suresh Kumar", mobile: "9876543210", email: "facility@abcindustries.example", address: "SIDCO Industrial Estate, Kurichi", city: "Coimbatore", pincode: "641021", creditDays: 30 },
    { name: "City Mall", gstin: "33AABCC5678D1Z9", contactPerson: "Priya Raman", mobile: "9876501234", email: "ops@citymall.example", address: "Avinashi Road, Peelamedu", city: "Coimbatore", pincode: "641004", creditDays: 15 },
    { name: "Hotel Grand", gstin: "33AAFHG4321E1Z1", contactPerson: "Joseph Mathew", mobile: "9845012345", email: "gm@hotelgrand.example", address: "Race Course Road", city: "Coimbatore", pincode: "641018", creditDays: 15 },
    { name: "XYZ Textiles", gstin: "29AAACX9876F1Z4", contactPerson: "Rajesh Gowda", mobile: "9900112233", email: "admin@xyztextiles.example", address: "Peenya Industrial Area", city: "Bengaluru", pincode: "560058", creditDays: 30 },
    { name: "City Corporation", contactPerson: "Assistant Commissioner (Health)", mobile: "9443012345", email: "health@citycorp.example", address: "Town Hall, Big Bazaar Street", city: "Coimbatore", pincode: "641001", creditDays: 45 },
  ];
  const cust: Record<string, string> = {};
  for (const c of customerDefs) {
    const r = await createEntity(ctx, "customer", { ...c, status: "ACTIVE", remarks: DEMO });
    await prisma.customer.update({ where: { id: r.id }, data: { isDemo: true } });
    cust[c.name] = r.id;
    await createEntity(ctx, "customerContact", { customerId: r.id, name: c.contactPerson, mobile: c.mobile, email: c.email, isPrimary: true });
  }
  const siteDefs: [string, string, string, string, string, string][] = [
    ["ABC Industries", "ABC Industries - Unit 1", "SIDCO Industrial Estate, Kurichi", "DRY", "DAILY", "09:00"],
    ["City Mall", "City Mall - Service Dock", "Avinashi Road, Peelamedu", "DRY", "DAILY", "07:00"],
    ["Hotel Grand", "Hotel Grand - Kitchen Yard", "Race Course Road", "WET", "DAILY", "06:30"],
    ["XYZ Textiles", "XYZ Textiles - Coimbatore Depot", "Ukkadam Bypass", "CARDBOARD", "TWICE_WEEKLY", "11:00"],
    ["City Corporation", "Ward 12 Transfer Point", "Gandhipuram, Ward 12", "MIXED", "DAILY", "05:30"],
  ];
  const site: Record<string, string> = {};
  for (const [c, name, address, w, frequency, time] of siteDefs) {
    const r = await createEntity(ctx, "site", {
      customerId: cust[c], name, address, defaultWasteTypeId: wt.get(w), frequency, collectionTime: time, status: "ACTIVE",
      latitude: 11 + rand() * 0.05, longitude: 76.95 + rand() * 0.05, remarks: DEMO,
    });
    site[c] = r.id;
  }

  const driverDefs = [
    { name: "Murugan S", mobile: "9787012345", licenceNumber: "TN3720150012345", licenceExpiry: day(900), joiningDate: "2021-04-01" },
    { name: "Senthil K", mobile: "9787023456", licenceNumber: "TN3720170023456", licenceExpiry: day(600), joiningDate: "2022-06-15" },
    { name: "Ganesh P", mobile: "9787034567", licenceNumber: "TN3720120034567", licenceExpiry: day(20), joiningDate: "2023-01-10" },
  ];
  const drivers: string[] = [];
  for (const d of driverDefs) drivers.push((await createEntity(ctx, "driver", { ...d, status: "ACTIVE", remarks: DEMO })).id);

  const vehicleDefs = [
    { number: "TN 37 AB 1234", type: "Compactor", capacityKg: 6000, standardTareKg: 5100, insuranceExpiry: day(240), fcExpiry: day(300), pollutionExpiry: day(120), permitExpiry: day(400), rcExpiry: day(2500) },
    { number: "TN 37 AB 5678", type: "Tipper", capacityKg: 8000, standardTareKg: 6200, insuranceExpiry: day(12), fcExpiry: day(200), pollutionExpiry: day(90), permitExpiry: day(300), rcExpiry: day(2200) },
    { number: "TN 37 AB 9012", type: "Mini Truck", capacityKg: 2500, standardTareKg: 2300, insuranceExpiry: day(180), fcExpiry: day(150), pollutionExpiry: day(-5), permitExpiry: day(200), rcExpiry: day(1800) },
  ];
  const vehicles: { id: string; tare: number; cap: number }[] = [];
  for (const [i, v] of vehicleDefs.entries()) {
    const r = await createEntity(ctx, "vehicle", { ...v, fuelType: "DIESEL", ownership: "OWNED", rcNumber: `RC-${v.number.replace(/ /g, "")}`, defaultDriverId: drivers[i], status: "ACTIVE", remarks: DEMO });
    vehicles.push({ id: r.id, tare: v.standardTareKg, cap: v.capacityKg });
  }

  const buyers: string[] = [];
  for (const b of [
    { name: "M/s Recycle Traders", gstin: "33AAAFR1111A1Z3", contactPerson: "Abdul Rahman", mobile: "9944011111", address: "Ukkadam, Coimbatore", paymentTermsDays: 15 },
    { name: "Green Material Buyers", gstin: "33AABFG2222B1Z7", contactPerson: "Kavitha N", mobile: "9944022222", address: "Ganapathy, Coimbatore", paymentTermsDays: 7 },
    { name: "ABC Recyclers", gstin: "32AAACA3333C1Z1", contactPerson: "Thomas V", mobile: "9944033333", address: "Palakkad, Kerala", paymentTermsDays: 15 },
  ]) {
    buyers.push((await createEntity(ctx, "buyer", { ...b, status: "ACTIVE", remarks: DEMO })).id);
  }
  const fuelSupplier = (await createEntity(ctx, "supplier", { name: "Sri Murugan Fuels", gstin: "33AAJFS4444D1Z5", contactPerson: "Manager", mobile: "9842044444", address: "Mettupalayam Road", paymentTermsDays: 15, status: "ACTIVE", remarks: DEMO })).id;
  const scrapSupplier = (await createEntity(ctx, "supplier", { name: "Kovai Scrap Aggregators", gstin: "33AAKFK5555E1Z8", contactPerson: "Selvam", mobile: "9842055555", address: "Sundarapuram", paymentTermsDays: 30, status: "ACTIVE", remarks: DEMO })).id;
  const garage = (await createEntity(ctx, "supplier", { name: "Annai Auto Works", contactPerson: "Mani", mobile: "9842066666", address: "Saravanampatti", paymentTermsDays: 0, status: "ACTIVE", remarks: DEMO })).id;

  log("Contracts & rates...");
  const startOfPrevPrevMonth = toISODate(new Date(Date.UTC(T.getUTCFullYear(), T.getUTCMonth() - 3, 1)));
  const startOfPrevMonth = toISODate(new Date(Date.UTC(T.getUTCFullYear(), T.getUTCMonth() - 1, 1)));
  const g18 = gst.get("GST 18%");
  const mk = async (c: string, title: string, terms: number, endDate?: string) =>
    (await createContract(ctx, { customerId: cust[c], title, startDate: startOfPrevPrevMonth, endDate, paymentTermsDays: terms, status: "ACTIVE", remarks: DEMO })).id;
  const cABC = await mk("ABC Industries", "Industrial dry waste collection & processing", 30, day(365));
  const abcRate = await addRate(ctx, { contractId: cABC, siteId: site["ABC Industries"], wasteTypeId: wt.get("DRY"), billingMethod: "WEIGHT", rate: 2.25, unit: "KG", taxTreatment: "TAXABLE", gstRateId: g18, effectiveFrom: startOfPrevPrevMonth, description: "Dry waste collection & processing" });
  await reviseRate(ctx, { rateId: abcRate.id, rate: 2.5, effectiveFrom: startOfPrevMonth, gstRateId: g18, description: "Dry waste collection & processing" });
  const cMall = await mk("City Mall", "Mall waste collection - per trip", 15, day(25));
  await addRate(ctx, { contractId: cMall, billingMethod: "TRIP", rate: 1500, unit: "TRIP", taxTreatment: "TAXABLE", gstRateId: g18, effectiveFrom: startOfPrevPrevMonth, description: "Mall dry waste collection" });
  const cHotel = await mk("Hotel Grand", "Kitchen wet waste collection", 15, day(300));
  await addRate(ctx, { contractId: cHotel, wasteTypeId: wt.get("WET"), billingMethod: "WEIGHT", rate: 1800, unit: "TONNE", taxTreatment: "TAXABLE", gstRateId: g18, effectiveFrom: startOfPrevPrevMonth, description: "Wet waste collection & composting" });
  const cXyz = await mk("XYZ Textiles", "Packaging waste collection", 30, day(200));
  await addRate(ctx, { contractId: cXyz, billingMethod: "WEIGHT", rate: 2.0, unit: "KG", taxTreatment: "TAXABLE", gstRateId: g18, effectiveFrom: startOfPrevPrevMonth, description: "Packaging & cardboard waste removal" });
  const cCorp = await mk("City Corporation", "Ward 12 secondary collection (fixed monthly)", 45, day(500));
  await addRate(ctx, { contractId: cCorp, billingMethod: "MONTHLY", rate: 150000, unit: "MONTH", taxTreatment: "TAXABLE", gstRateId: g18, effectiveFrom: startOfPrevPrevMonth, description: "Ward 12 secondary collection & transport" });

  log("Collections & weighments (45 days)...");
  const plan: { c: string; w: string; min: number; max: number; days: (d: number) => boolean; time: string }[] = [
    { c: "ABC Industries", w: "DRY", min: 1800, max: 3600, days: () => true, time: "09:30" },
    { c: "City Mall", w: "DRY", min: 900, max: 1700, days: () => true, time: "07:45" },
    { c: "Hotel Grand", w: "WET", min: 450, max: 900, days: () => true, time: "07:00" },
    { c: "XYZ Textiles", w: "CARDBOARD", min: 700, max: 1400, days: (d) => d % 3 === 0, time: "11:30" },
    { c: "City Corporation", w: "MIXED", min: 2500, max: 3800, days: (d) => d % 2 === 0, time: "06:15" },
  ];
  let slip = 70000;
  for (let off = -45; off <= -1; off++) {
    for (const [pi, p] of plan.entries()) {
      if (!p.days(off + 100)) continue;
      const v = vehicles[(pi + off + 100) % 3];
      const net = Math.round(p.min + rand() * (p.max - p.min));
      const tare = v.tare + Math.round(rand() * 40 - 20);
      const driverId = drivers[(pi + off + 100) % 3];
      const col = await createCollection(ctx, {
        customerId: cust[p.c], siteId: site[p.c], vehicleId: v.id, driverId, wasteTypeId: wt.get(p.w),
        collectionDate: at(off, p.time), estimatedQty: Math.round(net / 100) * 100, actualQty: net, status: "COMPLETED", remarks: DEMO,
      });
      const [hh, mm] = p.time.split(":").map(Number);
      const inTime = `${String(Math.min(hh + 1, 22)).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
      const outTime = `${String(Math.min(hh + 2, 23)).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
      const w = await gateIn(ctx, {
        collectionEntryId: col.id, vehicleId: v.id, driverId, customerId: cust[p.c], siteId: site[p.c], wasteTypeId: wt.get(p.w),
        locationId: YARD, gateInAt: at(off, inTime), grossWeight: tare + net, slipNumber: `WB-${slip++}`,
      });
      await gateOut(ctx, { weighmentId: w.id, tareWeight: tare, gateOutAt: at(off, outTime) });
    }

    // Processing every 3 days: process most of the raw stock in the yard
    if ((off + 100) % 3 === 0) {
      const bal = async (code: string) => Number((await prisma.inventoryBalance.findUnique({ where: { itemId_locationId: { itemId: item.get(code)!, locationId: YARD } } }))?.quantity ?? 0);
      const dry = Math.floor((await bal("RAW-DRY")) * 0.9);
      if (dry > 500) {
        const out = { p: round3(dry * 0.3), pa: round3(dry * 0.2), cb: round3(dry * 0.15), m: round3(dry * 0.05), g: round3(dry * 0.05) };
        const rej = round3(dry * 0.18);
        const loss = round3(dry - out.p - out.pa - out.cb - out.m - out.g - rej);
        await createProcessingBatch(ctx, {
          batchNo: `DRY-${day(off).replace(/-/g, "")}`, date: day(off), locationId: YARD,
          inputs: [{ itemId: item.get("RAW-DRY"), quantity: dry }],
          outputs: [
            { itemId: item.get("RCV-PLASTIC"), quantity: out.p }, { itemId: item.get("RCV-PAPER"), quantity: out.pa },
            { itemId: item.get("RCV-CARDBOARD"), quantity: out.cb }, { itemId: item.get("RCV-METAL"), quantity: out.m },
            { itemId: item.get("RCV-GLASS"), quantity: out.g },
          ],
          rejectedQty: rej, lossQty: loss, remarks: `${DEMO} - manual segregation line`,
        });
      }
      const wet = Math.floor(await bal("RAW-WET"));
      if (wet > 300) {
        const compost = round3(wet * 0.3);
        const rej = round3(wet * 0.08);
        await createProcessingBatch(ctx, {
          batchNo: `WET-${day(off).replace(/-/g, "")}`, date: day(off), locationId: YARD,
          inputs: [{ itemId: item.get("RAW-WET"), quantity: wet }],
          outputs: [{ itemId: item.get("RCV-COMPOST"), quantity: compost }],
          rejectedQty: rej, lossQty: round3(wet - compost - rej), remarks: `${DEMO} - windrow composting (moisture loss)`,
        });
      }
      const card = Math.floor(await bal("RAW-CARDBOARD"));
      if (card > 300) {
        const o = round3(card * 0.92);
        const rej = round3(card * 0.05);
        await createProcessingBatch(ctx, {
          batchNo: `CB-${day(off).replace(/-/g, "")}`, date: day(off), locationId: YARD,
          inputs: [{ itemId: item.get("RAW-CARDBOARD"), quantity: card }],
          outputs: [{ itemId: item.get("RCV-CARDBOARD"), quantity: o }],
          rejectedQty: rej, lossQty: round3(card - o - rej), remarks: DEMO,
        });
      }
      const mixed = Math.floor((await bal("RAW-MIXED")) * 0.8);
      if (mixed > 500) {
        const p = round3(mixed * 0.08);
        const pa = round3(mixed * 0.05);
        const rej = round3(mixed * 0.77);
        await createProcessingBatch(ctx, {
          batchNo: `MIX-${day(off).replace(/-/g, "")}`, date: day(off), locationId: YARD,
          inputs: [{ itemId: item.get("RAW-MIXED"), quantity: mixed }],
          outputs: [{ itemId: item.get("RCV-PLASTIC"), quantity: p }, { itemId: item.get("RCV-PAPER"), quantity: pa }],
          rejectedQty: rej, lossQty: round3(mixed - p - pa - rej), remarks: DEMO,
        });
      }
    }

    // Weekly: dispose rejects, sell recyclables, fuel, labour
    if ((off + 100) % 7 === 0) {
      const rejBal = Number((await prisma.inventoryBalance.findUnique({ where: { itemId_locationId: { itemId: item.get("REJECT")!, locationId: YARD } } }))?.quantity ?? 0);
      if (rejBal > 100) {
        await recordStockMovement(ctx, { kind: "DISPOSAL", date: day(off), itemId: item.get("REJECT"), locationId: YARD, quantity: Math.floor(rejBal * 0.9), remarks: `${DEMO} - sent to authorised landfill` });
      }
      const sellable: [string, number][] = [["RCV-PLASTIC", 22], ["RCV-PAPER", 9], ["RCV-CARDBOARD", 11], ["RCV-METAL", 32], ["RCV-COMPOST", 6], ["RCV-GLASS", 3]];
      const lines = [];
      for (const [code, rate] of sellable) {
        const b = Number((await prisma.inventoryBalance.findUnique({ where: { itemId_locationId: { itemId: item.get(code)!, locationId: YARD } } }))?.quantity ?? 0);
        const q = Math.floor(b * 0.7);
        if (q > 50) lines.push({ itemId: item.get(code), quantity: q, rate: rate + Math.round(rand() * 2) });
      }
      if (lines.length) {
        const buyer = buyers[(off + 100) % 3];
        await createSalesInvoice(ctx, { date: day(off), buyerId: buyer, locationId: YARD, vehicleNumber: "TN 38 CD 4567", items: lines, remarks: DEMO });
      }
      for (const v of vehicles) {
        const litres = Math.round(80 + rand() * 60);
        await createFuelEntry(ctx, { vehicleId: v.id, date: day(off), litres, ratePerLitre: 92.5, odometer: 40000 + (off + 50) * 120, fuelStation: "Sri Murugan Fuels", paymentMode: "CREDIT", supplierId: fuelSupplier });
      }
      await createExpense(ctx, { date: day(off), categoryId: cat.get("LABOUR"), description: "Weekly segregation labour wages", amount: 42000, gstRate: 0, paymentMode: "CASH", accountId: acc.get("1000"), remarks: DEMO });
    }
  }

  log("Monthly expenses, purchases, maintenance...");
  for (const m of [-2, -1]) {
    const first = toISODate(new Date(Date.UTC(T.getUTCFullYear(), T.getUTCMonth() + m, 5)));
    if (first < day(-45)) continue;
    await createExpense(ctx, { date: first, categoryId: cat.get("RENT"), description: "Facility rent", amount: 85000, gstRate: 18, paymentMode: "BANK_TRANSFER", accountId: acc.get("1010"), reference: `NEFT-RENT-${m}`, remarks: DEMO });
    await createExpense(ctx, { date: first, categoryId: cat.get("ELECTRICITY"), description: "TNEB electricity bill - MRF", amount: 26400, gstRate: 0, paymentMode: "BANK_TRANSFER", accountId: acc.get("1010"), reference: `TNEB-${m}`, remarks: DEMO });
    await createExpense(ctx, { date: first, categoryId: cat.get("OFFICE"), description: "Stationery & internet", amount: 6800, gstRate: 18, paymentMode: "UPI", accountId: acc.get("1010"), remarks: DEMO });
  }
  await createMaintenanceEntry(ctx, { vehicleId: vehicles[1].id, date: day(-20), maintenanceType: "SERVICE", description: "Periodic service - oil & filters", supplierId: garage, amount: 14500, odometer: 41200, nextServiceDate: day(70), paymentMode: "CASH", accountId: acc.get("1000") });
  await createMaintenanceEntry(ctx, { vehicleId: vehicles[0].id, date: day(-9), maintenanceType: "REPAIR", description: "Compactor hydraulic hose replacement", supplierId: garage, amount: 8200, odometer: 43800, paymentMode: "CASH", accountId: acc.get("1000") });
  const pur = await createPurchase(ctx, {
    date: day(-15), supplierId: scrapSupplier, billNumber: "KSA/1187", billDate: day(-15), locationId: YARD, remarks: DEMO,
    items: [
      { itemId: item.get("RCV-CARDBOARD"), description: "Sorted cardboard scrap", quantity: 1200, unit: "KG", rate: 7.5, gstRate: 5, hsnCode: "4707" },
      { description: "HDPE baling straps & bags", quantity: 50, unit: "NOS", rate: 120, gstRate: 18, hsnCode: "3923" },
    ],
  });
  await createPayment(ctx, { date: day(-5), supplierId: scrapSupplier, amount: Number(pur.total), mode: "BANK_TRANSFER", accountId: acc.get("1010"), reference: "NEFT-KSA-1187", allocations: [{ docType: "PURCHASE", docId: pur.id, amount: Number(pur.total) }] });
  const fuelBills = await prisma.expense.findMany({ where: { supplierId: fuelSupplier, paymentStatus: "UNPAID" }, orderBy: { date: "asc" } });
  const toPay = fuelBills.slice(0, Math.max(0, fuelBills.length - 3));
  if (toPay.length) {
    const amt = toPay.reduce((s, e) => s + Number(e.total), 0);
    await createPayment(ctx, { date: day(-3), supplierId: fuelSupplier, amount: Math.round(amt * 100) / 100, mode: "BANK_TRANSFER", accountId: acc.get("1010"), reference: "NEFT-FUEL", allocations: toPay.map((e) => ({ docType: "EXPENSE", docId: e.id, amount: Number(e.total) })) });
  }

  log("Customer invoices & receipts...");
  const periods: { from: string; to: string; date: string }[] = [];
  for (const m of [-2, -1]) {
    const from = toISODate(new Date(Date.UTC(T.getUTCFullYear(), T.getUTCMonth() + m, 1)));
    const to = toISODate(new Date(Date.UTC(T.getUTCFullYear(), T.getUTCMonth() + m + 1, 0)));
    const date = toISODate(new Date(Date.UTC(T.getUTCFullYear(), T.getUTCMonth() + m + 1, 1)));
    periods.push({ from, to, date });
  }
  for (const [pi, p] of periods.entries()) {
    for (const name of Object.keys(cust)) {
      const inv = await createCustomerInvoice(ctx, { customerId: cust[name], date: p.date, periodFrom: p.from, periodTo: p.to, includeAuto: true, notes: DEMO }).catch(() => null);
      if (!inv) continue;
      const total = Number(inv.total);
      const pay = (amount: number, d: string, ref: string) =>
        createReceipt(ctx, { date: d, partyType: "CUSTOMER", customerId: cust[name], amount, mode: "BANK_TRANSFER", accountId: acc.get("1010"), reference: ref, allocations: [{ invoiceId: inv.id, amount }] });
      if (pi === 0) {
        if (name !== "Hotel Grand") await pay(total, toISODate(addDays(dateOnly(p.date), 12)), `UTR${Math.floor(rand() * 1e9)}`);
      } else if (name === "ABC Industries") {
        await pay(Math.round(total * 0.6), day(-1), `UTR${Math.floor(rand() * 1e9)}`);
      } else if (name === "City Mall") {
        await pay(total, day(-2), `UTR${Math.floor(rand() * 1e9)}`);
      }
    }
  }
  const buyerSales = await prisma.salesInvoice.findMany({ where: { status: "POSTED" }, orderBy: { date: "asc" } });
  for (const s of buyerSales.slice(0, Math.max(0, buyerSales.length - 2))) {
    await createReceipt(ctx, { date: toISODate(addDays(s.date, 5)), partyType: "BUYER", buyerId: s.buyerId, amount: Number(s.total), mode: "BANK_TRANSFER", accountId: acc.get("1010"), reference: `RTGS-${s.number}`, allocations: [{ invoiceId: s.id, amount: Number(s.total) }] });
  }

  log("Today's operations...");
  await recordStockMovement(ctx, { kind: "TRANSFER", date: day(-1), itemId: item.get("RCV-METAL"), locationId: YARD, toLocationId: loc.get("STORE-1"), quantity: 50, remarks: `${DEMO} - moved to secure store` });
  // Sample weighment from the specification: Gross 8,540 KG - Tare 5,100 KG = Net 3,440 KG
  const sample = await gateIn(ctx, {
    vehicleId: vehicles[0].id, driverId: drivers[0], customerId: cust["ABC Industries"], siteId: site["ABC Industries"], wasteTypeId: wt.get("DRY"),
    locationId: YARD, gateInAt: at(0, "08:10"), grossWeight: 8540, slipNumber: "WB-SAMPLE-1", remarks: `${DEMO} - specification sample weighment`,
  });
  await gateOut(ctx, { weighmentId: sample.id, tareWeight: 5100, gateOutAt: at(0, "08:55") });
  // An open (gate-in only) weighment
  await gateIn(ctx, { vehicleId: vehicles[2].id, driverId: drivers[2], customerId: cust["Hotel Grand"], siteId: site["Hotel Grand"], wasteTypeId: wt.get("WET"), locationId: YARD, gateInAt: at(0, "09:20"), grossWeight: 3120, slipNumber: "WB-OPEN-1", remarks: DEMO });

  await generateDailySchedules(ctx, today);
  const todays = await prisma.collectionSchedule.findMany({ where: { scheduledDate: T }, orderBy: { scheduledTime: "asc" } });
  for (const [i, s] of todays.entries()) {
    if (i >= 3) break;
    await assignSchedule(ctx, { scheduleId: s.id, vehicleId: vehicles[i % 2].id, driverId: drivers[i % 2] });
    if (i === 0) await startSchedule(ctx, s.id);
  }
  await createPickup(ctx, { customerId: cust["City Mall"], siteId: site["City Mall"], wasteTypeId: wt.get("PLASTIC"), requestedDate: today, requestedTime: "15:00", priority: "HIGH", estimatedQty: 600, remarks: `${DEMO} - festival season extra pickup` });
  await createPickup(ctx, { customerId: cust["XYZ Textiles"], siteId: site["XYZ Textiles"], wasteTypeId: wt.get("CARDBOARD"), requestedDate: day(1), requestedTime: "11:00", priority: "NORMAL", estimatedQty: 900, remarks: DEMO });
  const p3 = await createPickup(ctx, { customerId: cust["ABC Industries"], siteId: site["ABC Industries"], wasteTypeId: wt.get("METAL"), requestedDate: day(1), requestedTime: "14:00", priority: "URGENT", estimatedQty: 400, remarks: `${DEMO} - machine shop scrap` });
  await createSchedule(ctx, { pickupRequestId: p3.id, customerId: cust["ABC Industries"], siteId: site["ABC Industries"], wasteTypeId: wt.get("METAL"), scheduledDate: day(1), scheduledTime: "14:00", vehicleId: vehicles[1].id, driverId: drivers[1] });

  await refreshNotifications(true);
  log("Demo data complete.");
}
