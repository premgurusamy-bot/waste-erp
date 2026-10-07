import { prisma } from "@/lib/db";
import { addDays, dateOnly, localDayRange, num, round2, round3, todayISO, toISODate } from "@/lib/utils";
import { monthlyPnl, outstandingByCustomer } from "../reports";

export type Period = "today" | "week" | "month" | "year" | "custom";

export function periodRange(period: Period, from?: string, to?: string): { from: string; to: string; label: string } {
  const today = todayISO();
  const t = dateOnly(today);
  switch (period) {
    case "today":
      return { from: today, to: today, label: "Today" };
    case "week": {
      const dow = (t.getUTCDay() + 6) % 7; // Monday start
      return { from: toISODate(addDays(t, -dow)), to: today, label: "This Week" };
    }
    case "year": {
      return { from: `${t.getUTCFullYear()}-01-01`, to: today, label: "This Year" };
    }
    case "custom":
      if (from && to && from <= to) return { from, to, label: `${from} to ${to}` };
      return periodRange("month");
    default:
      return { from: `${today.slice(0, 7)}-01`, to: today, label: "This Month" };
  }
}

export async function getDashboard(fromISO: string, toISO: string) {
  const today = todayISO();
  const range = localDayRange(fromISO, toISO);
  const dRange = { gte: dateOnly(fromISO), lte: dateOnly(toISO) };
  const todayRange = localDayRange(today, today);
  const monthRange = localDayRange(`${today.slice(0, 7)}-01`, today);

  const [
    customers,
    tripsToday,
    wToday,
    wMonth,
    wPeriod,
    batches,
    salesInv,
    serviceInv,
    expenses,
    purchases,
    pickupsCount,
    collectionsCount,
    receiptsAgg,
    outputs,
    salesItems,
  ] = await Promise.all([
    prisma.customer.count({ where: { status: "ACTIVE" } }),
    prisma.collectionEntry.count({ where: { collectionDate: todayRange, status: { in: ["COMPLETED", "PARTIAL"] } } }),
    prisma.weighment.aggregate({ where: { status: "COMPLETED", gateInAt: todayRange }, _sum: { netWeight: true }, _count: true }),
    prisma.weighment.aggregate({ where: { status: "COMPLETED", gateInAt: monthRange }, _sum: { netWeight: true } }),
    prisma.weighment.findMany({
      where: { status: "COMPLETED", gateInAt: range },
      select: { gateInAt: true, netWeight: true, wasteType: { select: { name: true } }, vehicle: { select: { number: true } }, customer: { select: { name: true } } },
    }),
    prisma.processingBatch.aggregate({ where: { status: "POSTED", date: dRange }, _sum: { inputQty: true, outputQty: true, rejectedQty: true, lossQty: true }, _count: true }),
    prisma.salesInvoice.aggregate({ where: { status: "POSTED", date: dRange }, _sum: { subtotal: true, total: true }, _count: true }),
    prisma.customerInvoice.aggregate({ where: { status: "POSTED", date: dRange }, _sum: { subtotal: true, total: true }, _count: true }),
    prisma.expense.aggregate({ where: { status: "POSTED", date: dRange }, _sum: { amount: true } }),
    prisma.purchase.aggregate({ where: { status: "POSTED", date: dRange }, _sum: { subtotal: true } }),
    prisma.pickupRequest.count({ where: { requestedDate: dRange, status: { not: "CANCELLED" } } }),
    prisma.collectionEntry.count({ where: { collectionDate: range, status: { in: ["COMPLETED", "PARTIAL"] } } }),
    prisma.receipt.aggregate({ where: { status: "POSTED", date: dRange }, _sum: { amount: true }, _count: true }),
    prisma.processingOutput.findMany({ where: { batch: { status: "POSTED", date: dRange } }, select: { quantity: true, item: { select: { name: true } } } }),
    prisma.salesInvoiceItem.findMany({ where: { salesInvoice: { status: "POSTED", date: dRange } }, select: { quantity: true, taxableValue: true, item: { select: { name: true } } } }),
  ]);

  const outstanding = (await outstandingByCustomer(today)).reduce((s, r) => s + (r.balance as number), 0);
  const serviceRevenue = num(serviceInv._sum.subtotal);
  const salesRevenue = num(salesInv._sum.subtotal);
  const operatingCost = round2(num(expenses._sum.amount) + num(purchases._sum.subtotal));

  // Trend: daily if range <= 62 days else monthly
  const days = (dateOnly(toISO).getTime() - dateOnly(fromISO).getTime()) / 86_400_000 + 1;
  const trend = new Map<string, number>();
  if (days <= 62) for (let i = 0; i < days; i++) trend.set(toISODate(addDays(dateOnly(fromISO), i)), 0);
  const byType = new Map<string, number>();
  const byVehicle = new Map<string, { kg: number; trips: number }>();
  const byCustomer = new Map<string, number>();
  for (const w of wPeriod) {
    const day = todayISO(w.gateInAt);
    const k = days <= 62 ? day : day.slice(0, 7);
    trend.set(k, round3((trend.get(k) ?? 0) + num(w.netWeight)));
    byType.set(w.wasteType.name, round3((byType.get(w.wasteType.name) ?? 0) + num(w.netWeight)));
    const v = byVehicle.get(w.vehicle.number) ?? { kg: 0, trips: 0 };
    v.kg = round3(v.kg + num(w.netWeight));
    v.trips++;
    byVehicle.set(w.vehicle.number, v);
    byCustomer.set(w.customer.name, round3((byCustomer.get(w.customer.name) ?? 0) + num(w.netWeight)));
  }
  const outByMat = new Map<string, number>();
  for (const o of outputs) outByMat.set(o.item.name, round3((outByMat.get(o.item.name) ?? 0) + num(o.quantity)));
  const salesByMat = new Map<string, { qty: number; value: number }>();
  for (const s of salesItems) {
    const r = salesByMat.get(s.item.name) ?? { qty: 0, value: 0 };
    r.qty = round3(r.qty + num(s.quantity));
    r.value = round2(r.value + num(s.taxableValue));
    salesByMat.set(s.item.name, r);
  }

  // Revenue vs cost: last 6 months always (independent of filter) for context
  const sixFrom = toISODate(new Date(Date.UTC(dateOnly(today).getUTCFullYear(), dateOnly(today).getUTCMonth() - 5, 1)));
  const pnl = await monthlyPnl({ from: sixFrom, to: today });

  const processed = num(batches._sum.inputQty);
  const recovered = num(batches._sum.outputQty);
  return {
    kpis: {
      totalCustomers: customers,
      tripsToday,
      weighmentsToday: wToday._count,
      collectedTodayKg: num(wToday._sum.netWeight),
      collectedMonthKg: num(wMonth._sum.netWeight),
      processedKg: processed,
      recyclableOutputKg: recovered,
      recoveryPct: processed ? round2((recovered / processed) * 100) : 0,
      salesRevenue: round2(serviceRevenue + salesRevenue),
      serviceRevenue: round2(serviceRevenue),
      recyclableRevenue: round2(salesRevenue),
      outstanding: round2(outstanding),
      operatingCost,
      estimatedProfit: round2(serviceRevenue + salesRevenue - operatingCost),
    },
    flow: {
      customers,
      pickups: pickupsCount,
      collections: collectionsCount,
      weighments: wPeriod.length,
      batches: batches._count,
      recoveredKg: recovered,
      sales: salesInv._count,
      invoices: serviceInv._count,
      payments: receiptsAgg._count,
      receivedAmount: num(receiptsAgg._sum.amount),
    },
    charts: {
      trend: [...trend.entries()].map(([date, kg]) => ({ date, kg })),
      wasteTypes: [...byType.entries()].map(([name, kg]) => ({ name, kg })).sort((a, b) => b.kg - a.kg),
      revenueVsCost: pnl.map((p) => ({ month: p.month, revenue: p.revenue, cost: round2(p.purchases + p.expenses), profit: p.profit })),
      processing: [...outByMat.entries()].map(([name, kg]) => ({ name, kg })).sort((a, b) => b.kg - a.kg),
      sales: [...salesByMat.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.value - a.value),
      vehicles: [...byVehicle.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.kg - a.kg),
      customers: [...byCustomer.entries()].map(([name, kg]) => ({ name, kg })).sort((a, b) => b.kg - a.kg).slice(0, 8),
    },
  };
}
