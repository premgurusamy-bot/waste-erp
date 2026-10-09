import { prisma } from "../db.js";
import { hashPassword } from "../auth.js";
import { systemCtx, type Ctx } from "../context.js";
import { ALL_PERMISSIONS } from "../../shared/permissions.js";
import { saveMaster } from "../services/masters.js";
import { saveTrip, setTripStatus } from "../services/trips.js";
import { saveExpense } from "../services/expenses.js";
import { createInvoice, createReceipt } from "../services/billing.js";
import { createPayment, listSettlements } from "../services/settlements.js";
import { saveTarget } from "../services/analytics.js";
import { addDays, todayIst, round2 } from "../../shared/calc.js";

export async function seedBase(opts: { adminPassword: string; companyName?: string }) {
  if (!(await prisma.company.findFirst())) {
    await prisma.company.create({
      data: {
        name: opts.companyName ?? "G Road Lines", legalName: "G Road Lines", gstin: "33ABCDE1234F1Z5", pan: "ABCDE1234F",
        address: "12, Trichy Road", city: "Coimbatore", state: "Tamil Nadu", stateCode: "33", pincode: "641018",
        phone: "0422-2345678", email: "accounts@groadlines.in", invoicePrefix: "GRL",
      },
    });
  }
  if (!(await prisma.user.findUnique({ where: { username: "admin" } }))) {
    await prisma.user.create({ data: { username: "admin", name: "Administrator", role: "SUPER_ADMIN", passwordHash: await hashPassword(opts.adminPassword) } });
  }
}

/** Small deterministic random generator so the demo data is the same every time. */
function rng(seed = 42) {
  let s = seed;
  const next = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  return { next, int: (a: number, b: number) => a + Math.floor(next() * (b - a + 1)), pick: <T>(arr: T[]) => arr[Math.floor(next() * arr.length)] };
}

export async function seedDemo(ctx: Ctx = systemCtx(ALL_PERMISSIONS, "Demo Seed")) {
  if (await prisma.trip.count()) return { skipped: true };
  const r = rng(7);
  const today = todayIst();
  const cities = ["Coimbatore", "Tiruppur", "Erode", "Salem", "Chennai", "Madurai", "Karur", "Trichy", "Hosur", "Pollachi", "Bengaluru", "Kochi"];
  const custNames = ["ABC Manufacturing", "Sri Lakshmi Textiles", "KPR Spinning Mills", "Annapoorna Foods", "Velan Steels", "Kumaran Agro Products", "Sakthi Polymers", "Pioneer Cements", "Murugan Paper Mills", "Royal Garments",
    "Excel Exports", "Sunrise Ceramics", "Balaji Cotton Traders", "Vishnu Engineering", "Green Valley Coir", "Star Packaging", "Tirumala Oils", "Kaveri Fertilizers", "Swathi Plastics", "Ganesh Hardware"];
  const customers: any[] = [];
  for (let i = 0; i < custNames.length; i++) {
    customers.push(await saveMaster(ctx, "customers", {
      name: custNames[i], company: `${custNames[i]} Pvt Ltd`, contactPerson: ["Ravi", "Suresh", "Priya", "Karthik", "Anitha"][i % 5], mobile: `98${String(43000000 + i * 7919).padStart(8, "0")}`,
      email: `accounts${i + 1}@example.in`, address: `${10 + i}, Industrial Estate`, city: cities[i % cities.length], state: "Tamil Nadu", paymentTerms: "Within credit days",
      creditDays: [15, 30, 30, 45, 60][i % 5], openingBalance: i % 4 === 0 ? 25000 : 0, gstin: `33AAACA${String(1000 + i).padStart(4, "0")}B1Z${i % 10}`,
    }));
  }
  const trNames = ["Sri Murugan Transports", "KMS Roadways", "Velmurugan Lorry Service", "Balu Logistics", "Annai Transports", "Sakthi Carriers", "Kongu Roadlines", "Ayyappa Transport", "SVR Logistics", "Bharath Freight Movers"];
  const transporters: any[] = [];
  for (let i = 0; i < trNames.length; i++) {
    transporters.push(await saveMaster(ctx, "transporters", {
      name: trNames[i], contactPerson: ["Mani", "Selvam", "Raja", "Kannan", "Babu"][i % 5], mobile: `97${String(51000000 + i * 3571).padStart(8, "0")}`, city: cities[(i + 3) % cities.length],
      address: `${5 + i}, Lorry Pettai`, bankName: ["Indian Bank", "SBI", "Canara Bank", "IOB"][i % 4], bankAccount: `${600000000 + i * 1237}`, bankIfsc: ["IDIB000C001", "SBIN0000881", "CNRB0001234", "IOBA0000123"][i % 4],
      paymentTerms: "Balance after POD", openingBalance: 0,
    }));
  }
  const types = ["10 Wheeler", "12 Wheeler", "14 Wheeler", "Trailer 40ft", "Tata Ace", "Eicher 17ft", "Container 32ft"];
  const vehicles: any[] = [];
  for (let i = 0; i < 20; i++) {
    const exp = (base: number) => addDays(today, base + r.int(-20, 300));
    vehicles.push(await saveMaster(ctx, "vehicles", {
      vehicleNumber: `TN${String([37, 38, 39, 33, 66, 41][i % 6]).padStart(2, "0")}${["AB", "BC", "CD", "DE", "AX", "BZ"][i % 6]}${String(1000 + i * 373).slice(0, 4)}`,
      vehicleType: types[i % types.length], capacityTons: [16, 21, 25, 30, 1, 9, 20][i % types.length], ownerName: trNames[i % 10].split(" ")[0], ownership: i < 3 ? "OWN" : "MARKET",
      transporterId: transporters[i % 10].id, rcExpiry: addDays(today, 900 + i), insuranceExpiry: i === 2 ? addDays(today, -3) : i === 5 ? addDays(today, 6) : exp(10),
      fcExpiry: i === 7 ? addDays(today, 12) : exp(40), permitExpiry: exp(60), pollutionExpiry: i === 9 ? addDays(today, 25) : exp(20), roadTaxExpiry: exp(80),
    }));
  }
  const drNames = ["Murugan", "Selvaraj", "Ramesh", "Senthil", "Kumar", "Arumugam", "Palani", "Ganesan", "Raju", "Velu", "Saravanan", "Manikandan", "Prakash", "Dinesh", "Siva",
    "Muthu", "Karthi", "Balaji", "Vijay", "Ajith", "Pandi", "Sekar", "Mohan", "Anand", "Gopal", "Ravi", "Suresh", "Krishnan", "Babu", "Ilango"];
  const drivers: any[] = [];
  for (let i = 0; i < drNames.length; i++) {
    drivers.push(await saveMaster(ctx, "drivers", {
      name: drNames[i], mobile: `90${String(30000000 + i * 4111).padStart(8, "0")}`, licenseNumber: `TN37 2015${String(100000 + i * 97).padStart(7, "0")}`,
      licenseExpiry: i === 4 ? addDays(today, -10) : i === 11 ? addDays(today, 14) : addDays(today, 120 + i * 37), address: `${cities[i % cities.length]}`,
      rate: [800, 1000, 1200][i % 3], rateType: "PER_TRIP", transporterId: transporters[i % 10].id,
    }));
  }
  const lps: any[] = [], dps: any[] = [];
  for (const c of ["Coimbatore", "Erode", "Salem", "Karur", "Pollachi", "Hosur"]) lps.push(await saveMaster(ctx, "loadingPoints", { name: c, city: c, state: "Tamil Nadu" }));
  for (const c of ["Tiruppur", "Chennai", "Madurai", "Trichy", "Bengaluru", "Kochi", "Salem", "Tuticorin"]) dps.push(await saveMaster(ctx, "deliveryPoints", { name: c, city: c, state: c === "Bengaluru" ? "Karnataka" : c === "Kochi" ? "Kerala" : "Tamil Nadu" }));
  const dist: Record<string, number> = { Tiruppur: 55, Chennai: 505, Madurai: 215, Trichy: 215, Bengaluru: 365, Kochi: 195, Salem: 165, Tuticorin: 340 };
  await saveMaster(ctx, "freightRates", { customerId: customers[0].id, loadingPointId: lps[0].id, deliveryPointId: dps[0].id, rateType: "PER_TRIP", customerRate: 30000, transporterRate: 22000, effectiveFrom: addDays(today, -365) });
  await saveMaster(ctx, "freightRates", { loadingPointId: lps[0].id, deliveryPointId: dps1(dps), rateType: "PER_TRIP", customerRate: 65000, transporterRate: 52000 });
  await saveMaster(ctx, "freightRates", { loadingPointId: lps[1].id, deliveryPointId: dps[4].id, rateType: "PER_TON", customerRate: 2400, transporterRate: 1950 });

  // ---- 100 trips over the last 75 days
  const trips: any[] = [];
  const materials = ["Cotton Yarn", "Garments", "Steel Coils", "Cement Bags", "Rice Bags", "Coir Products", "Paper Rolls", "Machinery Parts", "Plastic Granules", "Fertilizer"];
  for (let i = 0; i < 100; i++) {
    const daysAgo = i === 0 ? 70 : Math.max(0, 75 - Math.floor(i * 0.76) - r.int(0, 1));
    const date = addDays(today, -daysAgo);
    const lp = i === 0 ? lps[0] : r.pick(lps);
    const dp = i === 0 ? dps[0] : r.pick(dps.filter((d) => d.name !== lp.name));
    const km = dist[dp.name] ?? 200;
    const v = vehicles[i % 20];
    const freight = i === 0 ? 30000 : Math.round((km * r.int(48, 62) + 6000) / 100) * 100;
    const hire = i === 0 ? 22000 : Math.round((freight * r.int(62, 70)) / 100 / 100) * 100;
    const ageStatus = daysAgo > 14 ? "POD RECEIVED" : daysAgo > 7 ? r.pick(["DELIVERED", "POD RECEIVED"]) : daysAgo > 2 ? r.pick(["IN TRANSIT", "DELIVERED", "LOADED"]) : r.pick(["BOOKED", "ALLOCATED", "LOADED"]);
    const t = await saveTrip(ctx, {
      tripDate: date, customerId: i === 0 ? customers[0].id : customers[r.int(0, 19)].id, transporterId: transporters[i % 10].id, vehicleId: v.id, driverId: drivers[i % 30].id,
      loadingPointId: lp.id, deliveryPointId: dp.id, material: materials[i % materials.length], quantity: r.int(100, 600), unit: "BAGS", weightTons: r.int(8, 25), distanceKm: km,
      lrNumber: `LR${String(5000 + i)}`, lrDate: date, ewayBillNumber: `${String(3110000000 + i * 7713).slice(0, 12)}`,
      customerFreight: freight, transporterHire: hire,
      loadingCharges: i === 0 ? 800 : r.int(2, 6) * 100, unloadingCharges: i === 0 ? 700 : r.int(2, 6) * 100, diesel: 0, toll: i === 0 ? 600 : r.int(2, 10) * 100,
      rto: i === 0 ? 0 : r.int(0, 2) * 100, driverBata: i === 0 ? 900 : r.int(4, 8) * 100, otherExpense: 0, advance: i === 0 ? 10000 : Math.round(hire * 0.5 / 100) * 100,
      status: ageStatus === "POD RECEIVED" ? "DELIVERED" : ageStatus,
      items: [{ description: materials[i % materials.length], packages: r.int(50, 400), weightTons: r.int(8, 25), invoiceRef: `CI-${2000 + i}`, value: r.int(2, 30) * 50000 }],
    });
    if (ageStatus === "POD RECEIVED") await setTripStatus(ctx, t.id, { status: "POD RECEIVED", date: addDays(date, 3) });
    trips.push({ ...t, daysAgo });
  }
  // first trip: Coimbatore -> Tiruppur, freight 30,000, hire 22,000, expenses 3,000 => profit 5,000

  // ---- 200 expenses: 120 linked to trips, 80 office / vehicle / salary
  const tripCats = ["DIESEL", "TOLL", "RTO", "DRIVER BATA", "LOADING", "UNLOADING", "OTHER"];
  for (let i = 0; i < 120; i++) {
    const t = trips[1 + (i % 99)];
    await saveExpense(ctx, {
      expenseDate: t.tripDate, category: r.pick(tripCats), amount: r.int(1, 8) * 50, tripId: t.id, payee: r.pick(["Driver", "Toll Plaza", "Fuel Station", "Loading Contractor"]),
      paymentMode: r.pick(["CASH", "UPI"]), paymentStatus: i % 15 === 0 ? "UNPAID" : "PAID", description: "Trip expense",
    });
  }
  const officeCats = ["REPAIR", "MAINTENANCE", "OFFICE", "OTHER", "DIESEL"];
  for (let i = 0; i < 80; i++) {
    const cat = i % 27 === 0 ? "SALARY" : officeCats[i % officeCats.length];
    await saveExpense(ctx, {
      expenseDate: addDays(today, -r.int(0, 75)), category: cat, amount: cat === "SALARY" ? r.int(15, 25) * 1000 : r.int(3, 25) * 100,
      vehicleId: ["REPAIR", "MAINTENANCE", "DIESEL"].includes(cat) ? vehicles[r.int(0, 2)].id : null,
      payee: cat === "SALARY" ? r.pick(["Office Staff", "Accountant"]) : cat === "OFFICE" ? "Office supplies" : "Workshop",
      paymentMode: r.pick(["CASH", "BANK", "UPI"]), paymentStatus: i % 10 === 0 ? "UNPAID" : "PAID", description: `${cat.toLowerCase()} expense`,
    });
  }

  // ---- 50 invoices from older trips (grouped per customer), receipts for most of them
  const billable = trips.filter((t) => t.daysAgo > 12);
  const byCustomer = new Map<string, any[]>();
  for (const t of billable) byCustomer.set(t.customerId, [...(byCustomer.get(t.customerId) ?? []), t]);
  const groups: any[][] = [];
  for (const list of byCustomer.values()) for (let i = 0; i < list.length; i += 1) groups.push([list[i]]);
  // merge some single-trip groups so that there are exactly 50 invoices
  while (groups.length > 50) {
    const idx = groups.findIndex((g, i) => groups.findIndex((h, j) => j > i && h[0].customerId === g[0].customerId) >= 0);
    if (idx < 0) break;
    const j = groups.findIndex((h, k) => k > idx && h[0].customerId === groups[idx][0].customerId);
    groups[idx].push(...groups[j]);
    groups.splice(j, 1);
  }
  let n = 0;
  for (const g of groups.slice(0, 50)) {
    const last = g.reduce((a, t) => (t.tripDate > a ? t.tripDate : a), g[0].tripDate);
    const invoiceDate = addDays(last, 5) > today ? today : addDays(last, 5);
    const inv = await createInvoice(ctx, {
      customerId: g[0].customerId, invoiceDate, tripIds: g.map((t) => t.id), otherCharges: n % 7 === 0 ? 500 : 0, otherChargesLabel: "Detention charges",
      gstType: n % 5 === 0 ? "CGST_SGST" : n % 5 === 1 ? "IGST" : n % 5 === 2 ? "RCM" : "NONE", gstRate: n % 5 < 2 ? 12 : 5,
    });
    if (n % 3 !== 2) {
      const total = Number(inv.total);
      const partial = n % 3 === 1;
      await createReceipt(ctx, {
        customerId: g[0].customerId, invoiceId: inv.id, receiptDate: addDays(invoiceDate, r.int(3, 20)) > today ? today : addDays(invoiceDate, r.int(3, 20)),
        amount: partial ? round2(total * 0.6) : round2(total - (n % 4 === 0 ? round2(total * 0.02) : 0)), tdsAmount: !partial && n % 4 === 0 ? round2(total * 0.02) : 0,
        mode: r.pick(["NEFT", "RTGS", "UPI", "CHEQUE"]), reference: `UTR${100000 + n}`,
      });
    }
    n++;
  }
  // on-account receipt
  await createReceipt(ctx, { customerId: customers[3].id, receiptDate: addDays(today, -5), amount: 15000, mode: "BANK", reference: "ADV-ONACC", notes: "Advance from customer" });

  // ---- transporter payments: settle older trips fully, some partially
  const st = await listSettlements(ctx, { pageSize: 200 });
  let k = 0;
  for (const s of st.rows as any[]) {
    const tr = trips.find((t) => t.id === s.tripId);
    if (!tr || tr.daysAgo < 15 || s.balance <= 0) continue;
    const amount = k % 4 === 3 ? round2(s.balance / 2) : s.balance;
    await createPayment(ctx, { transporterId: s.transporterId, settlementId: s.id, paymentDate: addDays(tr.tripDate, r.int(5, 12)), amount, mode: r.pick(["NEFT", "UPI", "CASH"]), reference: `TP${2000 + k}` });
    k++;
  }

  // ---- targets
  await saveTarget(ctx, { period: "MONTHLY", metric: "PROFIT", amount: 100000, date: today });
  await saveTarget(ctx, { period: "DAILY", metric: "PROFIT", amount: 3500, date: today });
  await saveTarget(ctx, { period: "WEEKLY", metric: "PROFIT", amount: 25000, date: today });
  await saveTarget(ctx, { period: "YEARLY", metric: "PROFIT", amount: 1200000, date: today });
  return { skipped: false, trips: trips.length };
}

function dps1(dps: any[]) { return dps[1].id; }
