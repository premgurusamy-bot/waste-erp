import type { NotificationSeverity } from "@prisma/client";
import { prisma } from "@/lib/db";
import { addDays, dateOnly, formatDate, formatMoney, num, round2, todayISO } from "@/lib/utils";

type Alert = { dedupeKey: string; type: string; severity: NotificationSeverity; title: string; message: string; link: string; module: string };

const EXPIRY_WARN_DAYS = 30;
const LAST_RUN_KEY = "notifications.lastRun";

export type ExpiryState = "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | "NOT_SET";

export function expiryState(date: Date | null | undefined, today = dateOnly(todayISO()), warnDays = EXPIRY_WARN_DAYS): ExpiryState {
  if (!date) return "NOT_SET";
  if (date < today) return "EXPIRED";
  if (date <= addDays(today, warnDays)) return "EXPIRING_SOON";
  return "ACTIVE";
}

/** Rebuild the alert list from current data. Cheap queries; throttled to once per 15 minutes. */
export async function refreshNotifications(force = false) {
  if (!force) {
    const last = await prisma.setting.findUnique({ where: { key: LAST_RUN_KEY } });
    if (last && Date.now() - Number(last.value) < 15 * 60_000) return;
  }
  const today = dateOnly(todayISO());
  const alerts: Alert[] = [];

  const vehicles = await prisma.vehicle.findMany({ where: { status: { not: "INACTIVE" } } });
  const docFields = [
    ["rcExpiry", "RC"],
    ["insuranceExpiry", "Insurance"],
    ["fcExpiry", "Fitness Certificate (FC)"],
    ["pollutionExpiry", "Pollution Certificate"],
    ["permitExpiry", "Permit"],
  ] as const;
  for (const v of vehicles) {
    for (const [field, label] of docFields) {
      const st = expiryState(v[field], today);
      if (st === "EXPIRED" || st === "EXPIRING_SOON") {
        alerts.push({
          dedupeKey: `veh:${v.id}:${field}`,
          type: "VEHICLE_DOCUMENT",
          severity: st === "EXPIRED" ? "CRITICAL" : "WARNING",
          title: `${v.number}: ${label} ${st === "EXPIRED" ? "expired" : "expiring soon"}`,
          message: `${label} ${st === "EXPIRED" ? "expired on" : "expires on"} ${formatDate(v[field])}.`,
          link: `/vehicles/${v.id}`,
          module: "vehicles",
        });
      }
    }
  }

  const drivers = await prisma.driver.findMany({ where: { status: "ACTIVE" } });
  for (const d of drivers) {
    const st = expiryState(d.licenceExpiry, today);
    if (st === "EXPIRED" || st === "EXPIRING_SOON") {
      alerts.push({
        dedupeKey: `drv:${d.id}:licence`,
        type: "DRIVER_LICENCE",
        severity: st === "EXPIRED" ? "CRITICAL" : "WARNING",
        title: `${d.name}: driving licence ${st === "EXPIRED" ? "expired" : "expiring soon"}`,
        message: `Licence ${d.licenceNumber} ${st === "EXPIRED" ? "expired on" : "expires on"} ${formatDate(d.licenceExpiry)}.`,
        link: `/drivers/${d.id}`,
        module: "drivers",
      });
    }
  }

  const contracts = await prisma.contract.findMany({
    where: { status: "ACTIVE", endDate: { not: null, lte: addDays(today, EXPIRY_WARN_DAYS) } },
    include: { customer: true },
  });
  for (const c of contracts) {
    const expired = c.endDate! < today;
    alerts.push({
      dedupeKey: `con:${c.id}`,
      type: "CONTRACT_EXPIRY",
      severity: expired ? "CRITICAL" : "WARNING",
      title: `Contract ${c.number} ${expired ? "has expired" : "expiring soon"}`,
      message: `${c.customer.name} - ${c.title} ends on ${formatDate(c.endDate)}.`,
      link: `/contracts/${c.id}`,
      module: "contracts",
    });
  }

  const overdue = await prisma.customerInvoice.groupBy({
    by: ["customerId"],
    where: { status: "POSTED", paymentStatus: { not: "PAID" }, dueDate: { lt: today } },
    _sum: { total: true, amountReceived: true },
    _count: true,
  });
  if (overdue.length) {
    const customers = await prisma.customer.findMany({ where: { id: { in: overdue.map((o) => o.customerId) } } });
    const names = new Map(customers.map((c) => [c.id, c.name]));
    for (const o of overdue) {
      const bal = round2(num(o._sum.total) - num(o._sum.amountReceived));
      alerts.push({
        dedupeKey: `ovd:${o.customerId}`,
        type: "OUTSTANDING",
        severity: "WARNING",
        title: `${names.get(o.customerId)}: ${o._count} overdue invoice(s)`,
        message: `Overdue balance ${formatMoney(bal)}.`,
        link: `/customers/${o.customerId}?tab=outstanding`,
        module: "receipts",
      });
    }
  }

  const pending = await prisma.pickupRequest.count({ where: { status: "PENDING", requestedDate: { lte: today } } });
  if (pending > 0) {
    alerts.push({
      dedupeKey: "pickups:pending",
      type: "PENDING_PICKUPS",
      severity: "INFO",
      title: `${pending} pickup request(s) awaiting scheduling`,
      message: "Pending pickups due today or earlier have not been scheduled yet.",
      link: "/pickups?status=PENDING",
      module: "pickups",
    });
  }

  const lossThreshold = Number((await prisma.setting.findUnique({ where: { key: "processing.lossAlertPercent" } }))?.value ?? 65);
  const batches = await prisma.processingBatch.findMany({ where: { status: "POSTED", date: { gte: addDays(today, -7) } } });
  for (const b of batches) {
    const lossPct = (num(b.lossQty) / num(b.inputQty)) * 100;
    if (lossPct > lossThreshold) {
      alerts.push({
        dedupeKey: `proc:${b.id}`,
        type: "PROCESSING_ISSUE",
        severity: "WARNING",
        title: `High process loss on ${b.number}`,
        message: `Loss is ${lossPct.toFixed(1)}% of input (threshold ${lossThreshold}%).`,
        link: `/processing/${b.id}`,
        module: "processing",
      });
    }
  }

  const items = await prisma.inventoryItem.findMany({ where: { active: true, reorderLevel: { not: null } }, include: { balances: true } });
  for (const it of items) {
    const stock = it.balances.reduce((s, b) => s + num(b.quantity), 0);
    if (stock < num(it.reorderLevel)) {
      alerts.push({
        dedupeKey: `stock:${it.id}`,
        type: "LOW_STOCK",
        severity: "INFO",
        title: `Low stock: ${it.name}`,
        message: `Stock ${stock.toFixed(0)} ${it.unit} is below the minimum level ${num(it.reorderLevel)} ${it.unit}.`,
        link: `/inventory?item=${it.id}`,
        module: "inventory",
      });
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const a of alerts) {
      await tx.notification.upsert({
        where: { dedupeKey: a.dedupeKey },
        update: { title: a.title, message: a.message, severity: a.severity, link: a.link, active: true },
        create: a,
      });
    }
    await tx.notification.updateMany({ where: { active: true, dedupeKey: { notIn: alerts.map((a) => a.dedupeKey) } }, data: { active: false } });
    await tx.setting.upsert({ where: { key: LAST_RUN_KEY }, update: { value: String(Date.now()) }, create: { key: LAST_RUN_KEY, value: String(Date.now()) } });
  });
}

export async function getNotificationsFor(userId: string, permissions: string[], limit = 30) {
  const modules = [...new Set(permissions.filter((p) => p.endsWith(".view")).map((p) => p.split(".")[0]))];
  const list = await prisma.notification.findMany({
    where: { active: true, module: { in: modules } },
    include: { reads: { where: { userId } } },
    orderBy: [{ severity: "desc" }, { updatedAt: "desc" }],
    take: limit,
  });
  return list.map((n) => ({
    id: n.id,
    title: n.title,
    message: n.message,
    link: n.link,
    severity: n.severity,
    type: n.type,
    read: n.reads.length > 0,
    updatedAt: n.updatedAt.toISOString(),
  }));
}

export async function markNotificationsRead(userId: string, ids: string[]) {
  await prisma.notificationRead.createMany({ data: ids.map((notificationId) => ({ notificationId, userId })), skipDuplicates: true });
}
