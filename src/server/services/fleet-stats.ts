import { prisma } from "@/lib/db";
import { dateOnly, localDayRange, num, round2, round3 } from "@/lib/utils";

/**
 * Per-vehicle performance for a period. Revenue is attributed from billed invoice lines:
 * weight-based lines by each weighment's net weight x rate; trip-based lines per collection trip.
 */
export async function vehicleStats(fromISO: string, toISO: string, vehicleId?: string) {
  const tRange = localDayRange(fromISO, toISO);
  const dRange = { gte: dateOnly(fromISO), lte: dateOnly(toISO) };
  const vWhere = vehicleId ? { id: vehicleId } : {};
  const vehicles = await prisma.vehicle.findMany({ where: vWhere, include: { defaultDriver: true }, orderBy: { number: "asc" } });
  const ids = vehicles.map((v) => v.id);
  const [weighments, trips, fuel, expenses, collections] = await Promise.all([
    prisma.weighment.findMany({
      where: { vehicleId: { in: ids }, status: "COMPLETED", gateInAt: tRange },
      select: { vehicleId: true, netWeight: true, customerInvoiceItem: { select: { rate: true, unit: true, billingMethod: true, invoice: { select: { status: true } } } } },
    }),
    prisma.collectionEntry.groupBy({ by: ["vehicleId"], where: { vehicleId: { in: ids }, collectionDate: tRange, status: { not: "NOT_COLLECTED" } }, _count: true }),
    prisma.vehicleFuel.groupBy({ by: ["vehicleId"], where: { vehicleId: { in: ids }, date: dRange, expense: { status: "POSTED" } }, _sum: { litres: true, amount: true } }),
    prisma.expense.findMany({ where: { vehicleId: { in: ids }, date: dRange, status: "POSTED" }, select: { vehicleId: true, amount: true, category: { select: { code: true } } } }),
    prisma.collectionEntry.findMany({
      where: { vehicleId: { in: ids }, collectionDate: tRange, customerInvoiceItemId: { not: null } },
      select: { vehicleId: true, customerInvoiceItem: { select: { rate: true, billingMethod: true, invoice: { select: { status: true } } } } },
    }),
  ]);
  return vehicles.map((v) => {
    const ws = weighments.filter((w) => w.vehicleId === v.id);
    const kg = round3(ws.reduce((s, w) => s + num(w.netWeight), 0));
    let revenue = 0;
    for (const w of ws) {
      const it = w.customerInvoiceItem;
      if (it && it.invoice.status === "POSTED" && it.billingMethod === "WEIGHT") revenue += num(w.netWeight) * num(it.rate) / (it.unit === "TONNE" ? 1000 : 1);
    }
    for (const c of collections.filter((c) => c.vehicleId === v.id)) {
      const it = c.customerInvoiceItem;
      if (it && it.invoice.status === "POSTED" && it.billingMethod === "TRIP") revenue += num(it.rate);
    }
    const f = fuel.find((x) => x.vehicleId === v.id);
    const ex = expenses.filter((e) => e.vehicleId === v.id);
    const fuelAmt = num(f?._sum.amount);
    const maint = ex.filter((e) => ["VEHICLE_MAINT", "REPAIRS"].includes(e.category.code)).reduce((s, e) => s + num(e.amount), 0);
    const totalExp = ex.reduce((s, e) => s + num(e.amount), 0);
    return {
      id: v.id,
      number: v.number,
      type: v.type,
      capacityKg: num(v.capacityKg),
      status: v.status,
      driver: v.defaultDriver?.name ?? null,
      trips: trips.find((t) => t.vehicleId === v.id)?._count ?? 0,
      weighments: ws.length,
      kg,
      fuelLitres: num(f?._sum.litres),
      fuel: round2(fuelAmt),
      maintenance: round2(maint),
      otherExpenses: round2(totalExp - fuelAmt - maint),
      expenses: round2(totalExp),
      revenue: round2(revenue),
      profit: round2(revenue - totalExp),
      kmplHint: null as number | null,
    };
  });
}
