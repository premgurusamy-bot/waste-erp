import { prisma } from "../db.js";
import { assertCan, type Ctx } from "../context.js";
import type { Permission } from "../../shared/permissions.js";
import { num, round2, todayIst, periodRange, tripProfit, addDays } from "../../shared/calc.js";
import { toDate } from "../lib/util.js";
import { badRequest } from "../lib/errors.js";
import { linkedExpenses } from "./trips.js";
import { profitSummary, receivables, payables, allTargets } from "./analytics.js";
import { expiryList } from "./alerts.js";

export type ColKind = "string" | "money" | "int" | "num" | "date" | "pct";
export type ReportCol = { key: string; header: string; kind: ColKind; width?: number };
export type ReportResult = { title: string; subtitle: string; columns: ReportCol[]; rows: Record<string, any>[]; totals?: Record<string, any> };
type Filters = { from: string; to: string; customerId?: string; transporterId?: string; vehicleId?: string; driverId?: string };
type ReportDef = { key: string; title: string; perm: Permission; filters: string[]; defaultRange: "day" | "month" | "fy" | "none"; run: (ctx: Ctx, f: Filters) => Promise<Omit<ReportResult, "title" | "subtitle">> };

const sumCols = (rows: any[], cols: ReportCol[], label = "TOTAL") => {
  const t: Record<string, any> = {};
  cols.forEach((c, i) => { if (i === 0) t[c.key] = label; else if (c.kind === "money" || c.kind === "int" || c.kind === "num") t[c.key] = round2(rows.reduce((a, r) => a + num(r[c.key]), 0)); });
  return t;
};

async function tripsInRange(f: Filters) {
  const where: any = { status: { not: "CANCELLED" }, tripDate: { gte: toDate(f.from)!, lte: toDate(f.to)! } };
  for (const k of ["customerId", "transporterId", "vehicleId", "driverId"] as const) if (f[k]) where[k] = f[k];
  const trips = await prisma.trip.findMany({
    where, orderBy: [{ tripDate: "asc" }, { tripNumber: "asc" }],
    include: { customer: { select: { name: true } }, transporter: { select: { name: true } }, vehicle: { select: { vehicleNumber: true } }, driver: { select: { name: true } }, loadingPoint: { select: { name: true } }, deliveryPoint: { select: { name: true } } },
  });
  const linked = await linkedExpenses(prisma, trips.map((t) => t.id));
  return trips.map((t) => ({ t, p: tripProfit(t, linked.get(t.id) ?? 0) }));
}

const TRIP_COLS: ReportCol[] = [
  { key: "tripNumber", header: "Trip No", kind: "string" }, { key: "tripDate", header: "Date", kind: "date" }, { key: "customer", header: "Customer", kind: "string", width: 22 },
  { key: "vehicle", header: "Vehicle", kind: "string" }, { key: "driver", header: "Driver", kind: "string" }, { key: "route", header: "Route", kind: "string", width: 26 },
  { key: "lrNumber", header: "LR", kind: "string" }, { key: "weightTons", header: "Weight (T)", kind: "num" }, { key: "distanceKm", header: "KM", kind: "num" },
  { key: "revenue", header: "Freight", kind: "money" }, { key: "hire", header: "Hire", kind: "money" }, { key: "expenses", header: "Other Costs", kind: "money" },
  { key: "profit", header: "Profit", kind: "money" }, { key: "status", header: "Status", kind: "string" },
];

async function tripReport(_: Ctx, f: Filters) {
  const rows = (await tripsInRange(f)).map(({ t, p }) => ({
    tripNumber: t.tripNumber, tripDate: t.tripDate.toISOString().slice(0, 10), customer: t.customer.name, vehicle: t.vehicle?.vehicleNumber ?? "", driver: t.driver?.name ?? "",
    route: `${t.loadingPoint?.name ?? ""} → ${t.deliveryPoint?.name ?? ""}`, lrNumber: t.lrNumber ?? "", weightTons: num(t.weightTons), distanceKm: num(t.distanceKm),
    revenue: p.revenue, hire: p.hire, expenses: round2(p.totalCost - p.hire), profit: p.profit, status: t.status,
  }));
  return { columns: TRIP_COLS, rows, totals: sumCols(rows, TRIP_COLS) };
}

function groupTrips(items: { t: any; p: ReturnType<typeof tripProfit> }[], keyOf: (t: any) => string | null, labelOf: (t: any) => string) {
  const m = new Map<string, any>();
  for (const { t, p } of items) {
    const k = keyOf(t) ?? "—";
    const g = m.get(k) ?? { name: labelOf(t) || "—", trips: 0, km: 0, weight: 0, revenue: 0, hire: 0, cost: 0, profit: 0, bata: 0 };
    g.trips++; g.km += p.distanceKm; g.weight += num(t.weightTons); g.revenue += p.revenue; g.hire += p.hire; g.cost += p.totalCost; g.profit += p.profit; g.bata += p.driverBata;
    m.set(k, g);
  }
  return [...m.values()].map((g) => ({
    ...g, km: round2(g.km), weight: round2(g.weight), revenue: round2(g.revenue), hire: round2(g.hire), cost: round2(g.cost), profit: round2(g.profit), bata: round2(g.bata),
    profitPct: g.revenue > 0 ? round2((g.profit / g.revenue) * 100) : 0, profitPerTrip: g.trips ? round2(g.profit / g.trips) : 0, profitPerKm: g.km > 0 ? round2(g.profit / g.km) : null,
  })).sort((a, b) => b.profit - a.profit);
}

const GROUP_COLS = (first: string): ReportCol[] => [
  { key: "name", header: first, kind: "string", width: 26 }, { key: "trips", header: "Trips", kind: "int" }, { key: "km", header: "KM", kind: "num" },
  { key: "revenue", header: "Revenue", kind: "money" }, { key: "cost", header: "Total Cost", kind: "money" }, { key: "profit", header: "Profit", kind: "money" },
  { key: "profitPct", header: "Profit %", kind: "pct" }, { key: "profitPerTrip", header: "Profit / Trip", kind: "money" }, { key: "profitPerKm", header: "Profit / KM", kind: "money" },
];

export const REPORTS: ReportDef[] = [
  { key: "daily-trips", title: "Daily Trip Report", perm: "trips.view", filters: ["date", "customer", "transporter", "vehicle", "driver"], defaultRange: "day", run: tripReport },
  { key: "monthly-trips", title: "Monthly Trip Report", perm: "trips.view", filters: ["date", "customer", "transporter", "vehicle", "driver"], defaultRange: "month", run: tripReport },
  {
    key: "customer", title: "Customer Report", perm: "billing.view", filters: ["date", "customer"], defaultRange: "month",
    run: async (ctx, f) => {
      const groups = groupTrips(await tripsInRange(f), (t) => t.customerId, (t) => t.customer.name);
      const inv = await prisma.customerInvoice.groupBy({ by: ["customerId"], where: { status: { not: "CANCELLED" }, invoiceDate: { gte: toDate(f.from)!, lte: toDate(f.to)! } }, _sum: { total: true } });
      const rc = await prisma.customerReceipt.groupBy({ by: ["customerId"], where: { status: "ACTIVE", receiptDate: { gte: toDate(f.from)!, lte: toDate(f.to)! } }, _sum: { amount: true, tdsAmount: true } });
      const out = await receivables(ctx);
      const customers = await prisma.customer.findMany({ select: { id: true, name: true } });
      const byName = new Map(customers.map((c) => [c.id, c.name]));
      const ids = new Set([...inv.map((i) => i.customerId), ...rc.map((r) => r.customerId)]);
      const g = new Map(groups.map((x: any) => [x.name, x]));
      const rows = [...new Set([...groups.map((x) => x.name), ...[...ids].map((i) => byName.get(i)!)])].map((name) => {
        const id = customers.find((c) => c.name === name)?.id;
        const gr: any = g.get(name) ?? {};
        return {
          name, trips: gr.trips ?? 0, revenue: gr.revenue ?? 0, profit: gr.profit ?? 0,
          invoiced: round2(num(inv.find((i) => i.customerId === id)?._sum.total)),
          received: round2(num(rc.find((r) => r.customerId === id)?._sum.amount) + num(rc.find((r) => r.customerId === id)?._sum.tdsAmount)),
          outstanding: out.rows.find((r) => r.customerId === id)?.total ?? 0,
        };
      }).filter((r) => !f.customerId || customers.find((c) => c.name === r.name)?.id === f.customerId);
      const columns: ReportCol[] = [{ key: "name", header: "Customer", kind: "string", width: 26 }, { key: "trips", header: "Trips", kind: "int" }, { key: "revenue", header: "Freight", kind: "money" }, { key: "profit", header: "Profit", kind: "money" }, { key: "invoiced", header: "Invoiced", kind: "money" }, { key: "received", header: "Received", kind: "money" }, { key: "outstanding", header: "Outstanding (today)", kind: "money" }];
      return { columns, rows, totals: sumCols(rows, columns) };
    },
  },
  {
    key: "transporter", title: "Transporter Report", perm: "settlements.view", filters: ["date", "transporter"], defaultRange: "month",
    run: async (_, f) => {
      const where: any = { status: { not: "CANCELLED" }, transporterId: f.transporterId ?? { not: null }, tripDate: { gte: toDate(f.from)!, lte: toDate(f.to)! } };
      const trips = await prisma.trip.findMany({ where, include: { transporter: { select: { name: true } }, settlement: { include: { payments: { where: { status: "ACTIVE" } } } } } });
      const m = new Map<string, any>();
      for (const t of trips) {
        const g = m.get(t.transporterId!) ?? { name: t.transporter!.name, trips: 0, hire: 0, advance: 0, deductions: 0, paid: 0, balance: 0 };
        const paid = t.settlement?.payments.reduce((a, p) => a + num(p.amount), 0) ?? 0;
        g.trips++; g.hire += num(t.transporterHire); g.advance += num(t.advance); g.deductions += num(t.settlement?.deductions); g.paid += paid;
        g.balance += num(t.transporterHire) - num(t.advance) - num(t.settlement?.deductions) - paid;
        m.set(t.transporterId!, g);
      }
      const rows = [...m.values()].map((g) => Object.fromEntries(Object.entries(g).map(([k, v]) => [k, typeof v === "number" ? round2(v) : v]))).sort((a: any, b: any) => b.hire - a.hire);
      const columns: ReportCol[] = [{ key: "name", header: "Transporter", kind: "string", width: 26 }, { key: "trips", header: "Trips", kind: "int" }, { key: "hire", header: "Hire", kind: "money" }, { key: "advance", header: "Advance", kind: "money" }, { key: "deductions", header: "Deductions", kind: "money" }, { key: "paid", header: "Paid", kind: "money" }, { key: "balance", header: "Balance", kind: "money" }];
      return { columns, rows, totals: sumCols(rows, columns) };
    },
  },
  {
    key: "vehicle", title: "Vehicle Report", perm: "trips.view", filters: ["date", "vehicle"], defaultRange: "month",
    run: async (_, f) => { const rows = groupTrips(await tripsInRange(f), (t) => t.vehicleId, (t) => t.vehicle?.vehicleNumber ?? "No vehicle"); const columns = GROUP_COLS("Vehicle"); return { columns, rows, totals: sumCols(rows, columns) }; },
  },
  {
    key: "driver", title: "Driver Report", perm: "trips.view", filters: ["date", "driver"], defaultRange: "month",
    run: async (_, f) => {
      const rows = groupTrips(await tripsInRange(f), (t) => t.driverId, (t) => t.driver?.name ?? "No driver");
      const columns: ReportCol[] = [{ key: "name", header: "Driver", kind: "string", width: 24 }, { key: "trips", header: "Trips", kind: "int" }, { key: "km", header: "KM", kind: "num" }, { key: "weight", header: "Weight (T)", kind: "num" }, { key: "bata", header: "Driver Bata", kind: "money" }, { key: "revenue", header: "Revenue", kind: "money" }, { key: "profit", header: "Profit", kind: "money" }];
      return { columns, rows, totals: sumCols(rows, columns) };
    },
  },
  {
    key: "expense", title: "Expense Report", perm: "expenses.view", filters: ["date", "vehicle", "driver"], defaultRange: "month",
    run: async (_, f) => {
      const where: any = { status: "ACTIVE", expenseDate: { gte: toDate(f.from)!, lte: toDate(f.to)! } };
      if (f.vehicleId) where.vehicleId = f.vehicleId;
      if (f.driverId) where.driverId = f.driverId;
      const ex = await prisma.expense.findMany({ where, orderBy: [{ expenseDate: "asc" }, { code: "asc" }], include: { trip: { select: { tripNumber: true } }, vehicle: { select: { vehicleNumber: true } }, driver: { select: { name: true } } } });
      const rows = ex.map((e) => ({ code: e.code, date: e.expenseDate.toISOString().slice(0, 10), category: e.category, trip: e.trip?.tripNumber ?? "", vehicle: e.vehicle?.vehicleNumber ?? "", driver: e.driver?.name ?? "", payee: e.payee ?? "", mode: e.paymentMode, status: e.paymentStatus, amount: num(e.amount) }));
      const columns: ReportCol[] = [{ key: "code", header: "Expense", kind: "string" }, { key: "date", header: "Date", kind: "date" }, { key: "category", header: "Category", kind: "string" }, { key: "trip", header: "Trip", kind: "string" }, { key: "vehicle", header: "Vehicle", kind: "string" }, { key: "driver", header: "Driver", kind: "string" }, { key: "payee", header: "Paid To", kind: "string" }, { key: "mode", header: "Mode", kind: "string" }, { key: "status", header: "Payment", kind: "string" }, { key: "amount", header: "Amount", kind: "money" }];
      return { columns, rows, totals: sumCols(rows, columns) };
    },
  },
  {
    key: "revenue", title: "Revenue Report", perm: "profit.view", filters: ["date", "customer"], defaultRange: "month",
    run: async (_, f) => {
      const m = new Map<string, any>();
      for (const { t, p } of await tripsInRange(f)) {
        const d = t.tripDate.toISOString().slice(0, 10);
        const g = m.get(d) ?? { date: d, trips: 0, revenue: 0, cost: 0, profit: 0 };
        g.trips++; g.revenue += p.revenue; g.cost += p.totalCost; g.profit += p.profit;
        m.set(d, g);
      }
      const rows = [...m.values()].map((g) => ({ ...g, revenue: round2(g.revenue), cost: round2(g.cost), profit: round2(g.profit) }));
      const columns: ReportCol[] = [{ key: "date", header: "Date", kind: "date" }, { key: "trips", header: "Trips", kind: "int" }, { key: "revenue", header: "Revenue", kind: "money" }, { key: "cost", header: "Trip Cost", kind: "money" }, { key: "profit", header: "Trip Profit", kind: "money" }];
      return { columns, rows, totals: sumCols(rows, columns) };
    },
  },
  {
    key: "profit-loss", title: "Profit / Loss Report", perm: "profit.view", filters: ["date"], defaultRange: "month",
    run: async (_, f) => {
      const p = await profitSummary(f.from, f.to);
      const L = (line: string, amount: number | null, note = "") => ({ line, amount, note });
      const rows = [
        L("Revenue (customer freight)", p.revenue, `${p.trips} trips`),
        L("Less: Transporter hire", -p.costs.transporterHire), L("Less: Loading", -p.costs.loadingCharges), L("Less: Unloading", -p.costs.unloadingCharges),
        L("Less: Diesel", -p.costs.diesel), L("Less: Toll", -p.costs.toll), L("Less: RTO", -p.costs.rto), L("Less: Driver bata", -p.costs.driverBata), L("Less: Other trip expense", -p.costs.otherExpense),
        L("Less: Expense entries linked to trips", -p.linkedExpenses),
        L("TRIP PROFIT", p.tripProfit),
        L("Less: Other expenses (office, salary, repair...)", -p.otherExpenses),
        L(p.netProfit >= 0 ? "NET PROFIT" : "NET LOSS", p.netProfit, `${p.profitPct}% of revenue`),
        L("Revenue / KM", p.revenuePerKm, `${p.distanceKm} km`), L("Cost / KM", p.costPerKm), L("Profit / KM", p.profitPerKm),
      ];
      return { columns: [{ key: "line", header: "Particulars", kind: "string", width: 44 }, { key: "amount", header: "Amount", kind: "money" }, { key: "note", header: "Note", kind: "string", width: 24 }] as ReportCol[], rows };
    },
  },
  {
    key: "route-profitability", title: "Route Profitability", perm: "profit.view", filters: ["date", "customer"], defaultRange: "month",
    run: async (_, f) => {
      const rows = groupTrips(await tripsInRange(f), (t) => `${t.loadingPointId}|${t.deliveryPointId}`, (t) => `${t.loadingPoint?.name ?? "?"} → ${t.deliveryPoint?.name ?? "?"}`);
      const columns = GROUP_COLS("Route");
      return { columns, rows, totals: sumCols(rows, columns) };
    },
  },
  {
    key: "customer-profitability", title: "Customer Profitability", perm: "profit.view", filters: ["date"], defaultRange: "month",
    run: async (_, f) => { const rows = groupTrips(await tripsInRange(f), (t) => t.customerId, (t) => t.customer.name); const columns = GROUP_COLS("Customer"); return { columns, rows, totals: sumCols(rows, columns) }; },
  },
  {
    key: "receivable-ageing", title: "Receivable Ageing", perm: "billing.view", filters: ["customer"], defaultRange: "none",
    run: async (ctx, f) => {
      const r = await receivables(ctx);
      const rows = r.rows.filter((x) => !f.customerId || x.customerId === f.customerId);
      const columns: ReportCol[] = [{ key: "code", header: "Code", kind: "string" }, { key: "name", header: "Customer", kind: "string", width: 26 }, { key: "mobile", header: "Mobile", kind: "string" }, { key: "0-30", header: "0-30", kind: "money" }, { key: "31-60", header: "31-60", kind: "money" }, { key: "61-90", header: "61-90", kind: "money" }, { key: "90+", header: "90+", kind: "money" }, { key: "total", header: "Total", kind: "money" }];
      return { columns, rows, totals: sumCols(rows, columns) };
    },
  },
  {
    key: "payable-ageing", title: "Payable Ageing", perm: "settlements.view", filters: ["transporter"], defaultRange: "none",
    run: async (ctx, f) => {
      const p = await payables(ctx);
      const rows: any[] = p.transporter.rows.filter((x) => !f.transporterId || x.transporterId === f.transporterId).map((r) => ({ ...r, type: "Transporter" }));
      if (!f.transporterId) {
        for (const d of p.driver.rows) rows.push({ type: "Driver", code: "", name: d.name, total: d.total, "0-30": null, "31-60": null, "61-90": null, "90+": null });
        for (const o of p.other.rows) rows.push({ type: "Other", code: "", name: o.payee, total: o.total, "0-30": null, "31-60": null, "61-90": null, "90+": null });
      }
      const columns: ReportCol[] = [{ key: "type", header: "Type", kind: "string" }, { key: "code", header: "Code", kind: "string" }, { key: "name", header: "Payee", kind: "string", width: 26 }, { key: "0-30", header: "0-30", kind: "money" }, { key: "31-60", header: "31-60", kind: "money" }, { key: "61-90", header: "61-90", kind: "money" }, { key: "90+", header: "90+", kind: "money" }, { key: "total", header: "Total", kind: "money" }];
      return { columns, rows, totals: sumCols(rows, columns) };
    },
  },
  {
    key: "target-achievement", title: "Target Achievement", perm: "profit.view", filters: [], defaultRange: "none",
    run: async (ctx) => {
      const t = await allTargets(ctx);
      const rows = t.map((x) => ({
        period: x.period, range: `${x.range.start} to ${x.range.end}`, metric: x.target?.metric ?? "", target: x.meter?.target ?? null, achieved: x.meter?.achieved ?? null,
        remaining: x.meter?.remaining ?? null, pct: x.meter?.achievementPct ?? null, required: x.meter?.requiredDaily ?? null, avg: x.meter?.currentDailyAverage ?? null,
        projected: x.meter?.projected ?? null, status: x.meter?.status ?? "NO TARGET SET",
      }));
      const columns: ReportCol[] = [{ key: "period", header: "Period", kind: "string" }, { key: "range", header: "Dates", kind: "string", width: 26 }, { key: "metric", header: "Metric", kind: "string" }, { key: "target", header: "Target", kind: "money" }, { key: "achieved", header: "Achieved", kind: "money" }, { key: "remaining", header: "Remaining", kind: "money" }, { key: "pct", header: "Achievement %", kind: "pct" }, { key: "required", header: "Required / Day", kind: "money" }, { key: "avg", header: "Current Avg / Day", kind: "money" }, { key: "projected", header: "Projected", kind: "money" }, { key: "status", header: "Status", kind: "string" }];
      return { columns, rows };
    },
  },
  {
    key: "expiry", title: "Expiry Report", perm: "masters.view", filters: [], defaultRange: "none",
    run: async () => {
      const rows = (await expiryList(todayIst(), 60)).map((e) => ({ ...e, kind: e.kind === "VEHICLE" ? "Vehicle" : "Driver" }));
      const columns: ReportCol[] = [{ key: "kind", header: "Type", kind: "string" }, { key: "name", header: "Vehicle / Driver", kind: "string", width: 22 }, { key: "document", header: "Document", kind: "string" }, { key: "expiryDate", header: "Expiry Date", kind: "date" }, { key: "daysLeft", header: "Days Left", kind: "int" }, { key: "level", header: "Alert", kind: "string" }];
      return { columns, rows };
    },
  },
  {
    key: "backup", title: "Backup Report", perm: "backup.create", filters: ["date"], defaultRange: "month",
    run: async (_, f) => {
      const b = await prisma.backupRecord.findMany({ where: { createdAt: { gte: toDate(f.from)!, lt: toDate(addDays(f.to, 1))! } }, orderBy: { createdAt: "desc" } });
      const rows = b.map((x) => ({ date: x.createdAt.toISOString().replace("T", " ").slice(0, 19), type: x.type, fileName: x.fileName, records: x.records, status: x.status, verified: x.verified ? "YES" : "NO", createdBy: x.createdBy ?? "" }));
      const columns: ReportCol[] = [{ key: "date", header: "Backup Date (UTC)", kind: "string", width: 20 }, { key: "type", header: "Type", kind: "string" }, { key: "fileName", header: "File Name", kind: "string", width: 44 }, { key: "records", header: "Records", kind: "int" }, { key: "status", header: "Status", kind: "string" }, { key: "verified", header: "Verified", kind: "string" }, { key: "createdBy", header: "Created By", kind: "string" }];
      return { columns, rows };
    },
  },
];

export function reportList(ctx: Ctx) {
  return REPORTS.filter((r) => ctx.permissions.has(r.perm)).map((r) => ({ key: r.key, title: r.title, filters: r.filters, defaultRange: r.defaultRange }));
}

export async function runReport(ctx: Ctx, key: string, q: any): Promise<ReportResult> {
  const def = REPORTS.find((r) => r.key === key);
  if (!def) throw badRequest("Unknown report.");
  assertCan(ctx, def.perm);
  const today = todayIst();
  const range = def.defaultRange === "day" ? { start: today, end: today } : def.defaultRange === "fy" ? periodRange("YEARLY", today) : periodRange("MONTHLY", today);
  const valid = (s: any) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const f: Filters = { from: valid(q.from) ? q.from : range.start, to: valid(q.to) ? q.to : range.end };
  for (const k of ["customerId", "transporterId", "vehicleId", "driverId"] as const) if (q[k] && /^[0-9a-f-]{36}$/.test(q[k])) f[k] = q[k];
  const r = await def.run(ctx, f);
  const subtitle = def.defaultRange === "none" ? `As of ${today}` : `${f.from} to ${f.to}`;
  return { title: def.title, subtitle, ...r };
}
