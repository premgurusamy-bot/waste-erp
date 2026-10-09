/**
 * Profit / loss, target meter, dashboard, receivables and payables.
 * All totals are computed in SQL aggregates (fast with 10,000+ trips) using the formulas in shared/calc.ts.
 */
import { prisma } from "../db.js";
import { assertCan, type Ctx } from "../context.js";
import { toDate, plain } from "../lib/util.js";
import { num, round2, todayIst, periodRange, targetMeter, addDays, daysBetween, ageingBucket, type PeriodType } from "../../shared/calc.js";
import { badRequest } from "../lib/errors.js";
import { backupHealth } from "../backup/service.js";
import { currentLicense } from "../license.js";

const COST_FIELDS = ["transporterHire", "loadingCharges", "unloadingCharges", "diesel", "toll", "rto", "driverBata", "otherExpense"] as const;

export type ProfitSummary = Awaited<ReturnType<typeof profitSummary>>;

/**
 * Net profit for a date range:
 *   Revenue (customer freight of trips dated in the range)
 * - Trip costs (hire, loading, unloading, diesel, toll, RTO, driver bata, other) of those trips
 * - Expense entries linked to those trips
 * - Other expense entries dated in the range (office, salary, repair...; also entries of cancelled trips)
 */
export async function profitSummary(from: string, to: string) {
  const range = { gte: toDate(from)!, lte: toDate(to)! };
  const tripWhere = { status: { not: "CANCELLED" }, tripDate: range };
  const [t, linked, overhead, byCat] = await Promise.all([
    prisma.trip.aggregate({ where: tripWhere, _sum: { customerFreight: true, distanceKm: true, weightTons: true, ...Object.fromEntries(COST_FIELDS.map((f) => [f, true])) } as any, _count: true }),
    prisma.expense.aggregate({ where: { status: "ACTIVE", trip: tripWhere }, _sum: { amount: true } }),
    prisma.expense.aggregate({ where: { status: "ACTIVE", expenseDate: range, OR: [{ tripId: null }, { trip: { status: "CANCELLED" } }] }, _sum: { amount: true } }),
    prisma.expense.groupBy({ by: ["category"], where: { status: "ACTIVE", OR: [{ trip: tripWhere }, { expenseDate: range, OR: [{ tripId: null }, { trip: { status: "CANCELLED" } }] }] }, _sum: { amount: true } }),
  ]);
  const s: any = t._sum;
  const revenue = num(s.customerFreight);
  const costs = Object.fromEntries(COST_FIELDS.map((f) => [f, round2(num(s[f]))])) as Record<(typeof COST_FIELDS)[number], number>;
  const tripCost = round2(Object.values(costs).reduce((a, b) => a + b, 0));
  const linkedExpenses = round2(num(linked._sum.amount));
  const otherExpenses = round2(num(overhead._sum.amount));
  const tripProfit = round2(revenue - tripCost - linkedExpenses);
  const netProfit = round2(tripProfit - otherExpenses);
  const km = num(s.distanceKm);
  const totalCost = round2(tripCost + linkedExpenses + otherExpenses);
  const perKm = (v: number) => (km > 0 ? round2(v / km) : null);
  return {
    from, to, trips: t._count, distanceKm: km, weightTons: num(s.weightTons),
    revenue: round2(revenue), costs, tripCost, linkedExpenses, otherExpenses, tripProfit, netProfit, totalCost,
    profitPct: revenue > 0 ? round2((netProfit / revenue) * 100) : 0,
    revenuePerKm: perKm(revenue), costPerKm: perKm(totalCost), profitPerKm: perKm(netProfit),
    expenseByCategory: byCat.map((c) => ({ category: c.category, amount: round2(num(c._sum.amount)) })).sort((a, b) => b.amount - a.amount),
    formula: `${round2(revenue)} - ${tripCost} (trip costs) - ${linkedExpenses} (trip expense entries) - ${otherExpenses} (other expenses) = ${netProfit}`,
  };
}

async function metricValue(metric: string, from: string, to: string) {
  if (to < from) return 0;
  if (metric === "TRIPS") return prisma.trip.count({ where: { status: { not: "CANCELLED" }, tripDate: { gte: toDate(from)!, lte: toDate(to)! } } });
  const p = await profitSummary(from, to);
  return metric === "REVENUE" ? p.revenue : p.netProfit;
}

export async function targetStatus(period: PeriodType, today = todayIst()) {
  const target = await prisma.target.findFirst({
    where: { period, startDate: { lte: toDate(today)! }, endDate: { gte: toDate(today)! } },
    orderBy: { createdAt: "desc" },
  });
  const range = target ? { start: target.startDate.toISOString().slice(0, 10), end: target.endDate.toISOString().slice(0, 10) } : periodRange(period, today);
  if (!target) return { period, target: null, range, meter: null };
  const achieved = await metricValue(target.metric, range.start, today < range.end ? today : range.end);
  const meter = targetMeter({ target: num(target.amount), achieved, start: range.start, end: range.end, today });
  return { period, target: plain(target), range, meter };
}

export async function allTargets(ctx: Ctx) {
  assertCan(ctx, "profit.view");
  const today = todayIst();
  return Promise.all((["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as PeriodType[]).map((p) => targetStatus(p, today)));
}

export async function saveTarget(ctx: Ctx, body: any) {
  assertCan(ctx, "targets.edit");
  const period = String(body?.period) as PeriodType;
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(period)) throw badRequest("Choose a period.");
  const metric = ["PROFIT", "REVENUE", "TRIPS"].includes(body?.metric) ? body.metric : "PROFIT";
  const amount = Number(body?.amount);
  if (!(amount > 0)) throw badRequest("Target amount must be more than zero.");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(body?.date ?? "") ? body.date : todayIst();
  const range = periodRange(period, date);
  const { audit } = await import("../audit.js");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.target.findFirst({ where: { period, startDate: toDate(range.start)!, metric } });
    const t = existing
      ? await tx.target.update({ where: { id: existing.id }, data: { amount, endDate: toDate(range.end)!, notes: body?.notes ?? existing.notes } })
      : await tx.target.create({ data: { period, metric, amount, startDate: toDate(range.start)!, endDate: toDate(range.end)!, notes: body?.notes ?? null } });
    await audit(tx, ctx, existing ? "EDIT" : "CREATE", { type: "TARGET", id: t.id, code: `${period} ${range.start}` }, existing, t);
    return plain(t);
  });
}

// ---------------------------------------------------------------- receivables / payables

type Item = { date: string; ref: string; amount: number };
type Aged = { total: number; "0-30": number; "31-60": number; "61-90": number; "90+": number };
function ageItems(items: Item[], credits: number, today: string): Aged {
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
  let c = credits;
  const out: Aged = { total: 0, "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const it of sorted) {
    let amt = it.amount;
    const use = Math.min(Math.max(c, 0), amt);
    amt -= use; c -= use;
    if (amt <= 0.004) continue;
    out[ageingBucket(daysBetween(it.date, today))] += amt;
    out.total += amt;
  }
  if (c > 0.004) out.total -= c; // advance received / paid in excess
  for (const k of Object.keys(out) as (keyof Aged)[]) out[k] = round2(out[k]);
  return out;
}

export async function receivables(ctx: Ctx, today = todayIst()) {
  assertCan(ctx, "billing.view");
  const [customers, invoices, receipts] = await Promise.all([
    prisma.customer.findMany({ select: { id: true, code: true, name: true, mobile: true, openingBalance: true, creditDays: true } }),
    prisma.customerInvoice.findMany({ where: { status: { not: "CANCELLED" } }, select: { id: true, customerId: true, invoiceDate: true, invoiceNumber: true, total: true } }),
    prisma.customerReceipt.groupBy({ by: ["customerId", "invoiceId"], where: { status: "ACTIVE" }, _sum: { amount: true, tdsAmount: true } }),
  ]);
  const allocated = new Map<string, number>();
  const unallocated = new Map<string, number>();
  for (const r of receipts) {
    const v = num(r._sum.amount) + num(r._sum.tdsAmount);
    if (r.invoiceId) allocated.set(r.invoiceId, (allocated.get(r.invoiceId) ?? 0) + v);
    else unallocated.set(r.customerId, (unallocated.get(r.customerId) ?? 0) + v);
  }
  const byCustomer = new Map<string, Item[]>();
  for (const i of invoices) {
    const bal = round2(num(i.total) - (allocated.get(i.id) ?? 0));
    if (Math.abs(bal) < 0.005) continue;
    const list = byCustomer.get(i.customerId) ?? [];
    list.push({ date: i.invoiceDate.toISOString().slice(0, 10), ref: i.invoiceNumber, amount: bal });
    byCustomer.set(i.customerId, list);
  }
  const rows = customers.map((c) => {
    const items = [...(byCustomer.get(c.id) ?? [])];
    if (num(c.openingBalance) > 0) items.push({ date: "2000-01-01", ref: "Opening balance", amount: num(c.openingBalance) });
    const credits = (unallocated.get(c.id) ?? 0) + (num(c.openingBalance) < 0 ? -num(c.openingBalance) : 0);
    return { customerId: c.id, code: c.code, name: c.name, mobile: c.mobile, ...ageItems(items, credits, today) };
  }).filter((r) => Math.abs(r.total) >= 0.005).sort((a, b) => b.total - a.total);
  const totals = rows.reduce((a, r) => { for (const k of ["total", "0-30", "31-60", "61-90", "90+"]) a[k] = round2((a[k] ?? 0) + (r as any)[k]); return a; }, {} as Record<string, number>);
  return { asOf: today, rows, totals };
}

export async function payables(ctx: Ctx, today = todayIst()) {
  assertCan(ctx, "settlements.view");
  const [transporters, settlements, unalloc, unpaid] = await Promise.all([
    prisma.transporter.findMany({ select: { id: true, code: true, name: true, mobile: true, openingBalance: true } }),
    prisma.transporterSettlement.findMany({
      where: { status: { not: "CANCELLED" }, trip: { status: { not: "CANCELLED" } } },
      select: { transporterId: true, deductions: true, code: true, trip: { select: { tripNumber: true, tripDate: true, transporterHire: true, advance: true } }, payments: { where: { status: "ACTIVE" }, select: { amount: true } } },
    }),
    prisma.transporterPayment.groupBy({ by: ["transporterId"], where: { status: "ACTIVE", settlementId: null }, _sum: { amount: true } }),
    prisma.expense.findMany({ where: { status: "ACTIVE", paymentStatus: "UNPAID" }, include: { driver: { select: { id: true, name: true } } } }),
  ]);
  const unallocated = new Map(unalloc.map((u) => [u.transporterId, num(u._sum.amount)]));
  const byT = new Map<string, Item[]>();
  for (const s of settlements) {
    const bal = round2(num(s.trip.transporterHire) - num(s.trip.advance) - num(s.deductions) - s.payments.reduce((a, p) => a + num(p.amount), 0));
    if (Math.abs(bal) < 0.005) continue;
    const list = byT.get(s.transporterId) ?? [];
    list.push({ date: s.trip.tripDate.toISOString().slice(0, 10), ref: s.trip.tripNumber, amount: bal });
    byT.set(s.transporterId, list);
  }
  const transporterRows = transporters.map((t) => {
    const items = [...(byT.get(t.id) ?? [])];
    if (num(t.openingBalance) > 0) items.push({ date: "2000-01-01", ref: "Opening balance", amount: num(t.openingBalance) });
    const credits = (unallocated.get(t.id) ?? 0) + (num(t.openingBalance) < 0 ? -num(t.openingBalance) : 0);
    return { transporterId: t.id, code: t.code, name: t.name, mobile: t.mobile, ...ageItems(items, credits, today) };
  }).filter((r) => Math.abs(r.total) >= 0.005).sort((a, b) => b.total - a.total);
  const driverMap = new Map<string, { driverId: string; name: string; total: number; count: number }>();
  const other = new Map<string, { payee: string; total: number; count: number }>();
  for (const e of unpaid) {
    if (e.driver) {
      const d = driverMap.get(e.driver.id) ?? { driverId: e.driver.id, name: e.driver.name, total: 0, count: 0 };
      d.total = round2(d.total + num(e.amount)); d.count++;
      driverMap.set(e.driver.id, d);
    } else {
      const key = e.payee || e.category;
      const o = other.get(key) ?? { payee: key, total: 0, count: 0 };
      o.total = round2(o.total + num(e.amount)); o.count++;
      other.set(key, o);
    }
  }
  const sum = (a: { total: number }[]) => round2(a.reduce((x, r) => x + r.total, 0));
  const driverRows = [...driverMap.values()].sort((a, b) => b.total - a.total);
  const otherRows = [...other.values()].sort((a, b) => b.total - a.total);
  return {
    asOf: today,
    transporter: { rows: transporterRows, total: sum(transporterRows) },
    driver: { rows: driverRows, total: sum(driverRows) },
    other: { rows: otherRows, total: sum(otherRows) },
    total: round2(sum(transporterRows) + sum(driverRows) + sum(otherRows)),
  };
}

// ---------------------------------------------------------------- dashboard

export async function dashboard(ctx: Ctx) {
  assertCan(ctx, "dashboard.view");
  const today = todayIst();
  const month = periodRange("MONTHLY", today);
  const showMoney = ctx.permissions.has("profit.view");
  const [todayP, monthP, monthTarget, statusCounts, pendingSettlements, todayTrips, recent, health, license, alerts] = await Promise.all([
    showMoney ? profitSummary(today, today) : null,
    showMoney ? profitSummary(month.start, today) : null,
    showMoney ? targetStatus("MONTHLY", today) : null,
    prisma.trip.groupBy({ by: ["status"], _count: true }),
    prisma.transporterSettlement.count({ where: { status: { in: ["PENDING", "PARTIAL"] }, trip: { status: { not: "CANCELLED" } } } }),
    prisma.trip.count({ where: { tripDate: toDate(today)!, status: { not: "CANCELLED" } } }),
    prisma.trip.findMany({ take: 8, orderBy: [{ tripDate: "desc" }, { tripNumber: "desc" }], include: { customer: { select: { name: true } }, vehicle: { select: { vehicleNumber: true } }, loadingPoint: { select: { name: true } }, deliveryPoint: { select: { name: true } } } }),
    backupHealth(),
    currentLicense(),
    prisma.notification.count({ where: { readAt: null } }),
  ]);
  const counts = Object.fromEntries(statusCounts.map((s) => [s.status, s._count])) as Record<string, number>;
  const rec = ctx.permissions.has("billing.view") ? await receivables(ctx, today) : null;
  const pay = ctx.permissions.has("settlements.view") ? await payables(ctx, today) : null;
  let series: { date: string; revenue: number; profit: number }[] = [];
  if (showMoney) {
    const from = addDays(today, -29);
    const rows = await prisma.$queryRaw<{ d: Date; revenue: number; cost: number }[]>`
      SELECT "tripDate" AS d, SUM("customerFreight")::float AS revenue,
             SUM("transporterHire" + "loadingCharges" + "unloadingCharges" + diesel + toll + rto + "driverBata" + "otherExpense")::float AS cost
      FROM trips WHERE status <> 'CANCELLED' AND "tripDate" BETWEEN ${toDate(from)} AND ${toDate(today)} GROUP BY 1`;
    const map = new Map(rows.map((r) => [r.d.toISOString().slice(0, 10), r]));
    for (let i = 0; i < 30; i++) {
      const d = addDays(from, i);
      const r = map.get(d);
      series.push({ date: d, revenue: round2(r?.revenue ?? 0), profit: round2((r?.revenue ?? 0) - (r?.cost ?? 0)) });
    }
  }
  return {
    today,
    todayRevenue: todayP?.revenue ?? null,
    todayProfit: todayP ? Math.max(0, todayP.netProfit) : null,
    todayLoss: todayP ? Math.max(0, -todayP.netProfit) : null,
    todayNet: todayP?.netProfit ?? null,
    monthRevenue: monthP?.revenue ?? null,
    monthProfit: monthP?.netProfit ?? null,
    monthTarget,
    receivable: rec?.totals.total ?? null,
    payable: pay?.total ?? null,
    activeTrips: ["BOOKED", "ALLOCATED", "LOADED", "IN TRANSIT"].reduce((a, s) => a + (counts[s] ?? 0), 0),
    pendingLoads: (counts["BOOKED"] ?? 0) + (counts["ALLOCATED"] ?? 0),
    inTransit: (counts["LOADED"] ?? 0) + (counts["IN TRANSIT"] ?? 0),
    delivered: counts["DELIVERED"] ?? 0,
    pendingPod: counts["DELIVERED"] ?? 0,
    pendingSettlement: pendingSettlements,
    todayTrips,
    statusCounts: counts,
    recentTrips: plain(recent),
    series,
    backup: health,
    license,
    unreadAlerts: alerts,
  };
}
