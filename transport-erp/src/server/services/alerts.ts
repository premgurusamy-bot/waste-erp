import { prisma } from "../db.js";
import { assertCan, type Ctx } from "../context.js";
import { daysBetween, expiryLevel, todayIst, addDays, displayDate } from "../../shared/calc.js";
import { toDate, plain, pageParams } from "../lib/util.js";
import { backupHealth } from "../backup/service.js";
import { currentLicense } from "../license.js";
import { getSettings } from "./settings.js";

const VEHICLE_DOCS = [
  ["rcExpiry", "RC"], ["insuranceExpiry", "Insurance"], ["fcExpiry", "FC"], ["permitExpiry", "Permit"], ["pollutionExpiry", "Pollution"], ["roadTaxExpiry", "Road Tax"],
] as const;

export type ExpiryItem = { kind: "VEHICLE" | "DRIVER"; id: string; name: string; document: string; expiryDate: string; daysLeft: number; level: string };

/** Everything that is expired or expires within `days` (default 60). */
export async function expiryList(today = todayIst(), days?: number): Promise<ExpiryItem[]> {
  const horizon = days ?? Number((await getSettings())["alerts.expiryDays"] ?? 60);
  const limit = toDate(addDays(today, horizon))!;
  const vehicles = await prisma.vehicle.findMany({
    where: { status: "ACTIVE", OR: VEHICLE_DOCS.map(([f]) => ({ [f]: { lte: limit } })) },
  });
  const drivers = await prisma.driver.findMany({ where: { status: "ACTIVE", licenseExpiry: { lte: limit } } });
  const out: ExpiryItem[] = [];
  for (const v of vehicles) {
    for (const [f, label] of VEHICLE_DOCS) {
      const d = (v as any)[f] as Date | null;
      if (!d || d > limit) continue;
      const iso = d.toISOString().slice(0, 10);
      const left = daysBetween(today, iso);
      out.push({ kind: "VEHICLE", id: v.id, name: v.vehicleNumber, document: label, expiryDate: iso, daysLeft: left, level: expiryLevel(left) ?? "" });
    }
  }
  for (const dr of drivers) {
    const iso = dr.licenseExpiry!.toISOString().slice(0, 10);
    const left = daysBetween(today, iso);
    out.push({ kind: "DRIVER", id: dr.id, name: dr.name, document: "Driver License", expiryDate: iso, daysLeft: left, level: expiryLevel(left) ?? "" });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

/** Refresh the notification table: expiry, backup reminders and licence warnings. Idempotent (keyed). */
export async function refreshNotifications() {
  const today = todayIst();
  const items = await expiryList(today);
  const upserts: { key: string; type: string; severity: string; title: string; message: string; entityType?: string; entityId?: string; dueDate?: Date | null }[] = [];
  for (const it of items) {
    const sev = it.daysLeft < 0 ? "CRITICAL" : it.daysLeft <= 7 ? "URGENT" : it.daysLeft <= 30 ? "WARNING" : "INFO";
    upserts.push({
      key: `EXPIRY:${it.kind}:${it.id}:${it.document}:${it.expiryDate}:${it.level}`,
      type: "EXPIRY", severity: sev,
      title: `${it.document} ${it.daysLeft < 0 ? "EXPIRED" : `expires in ${it.daysLeft} day(s)`} - ${it.name}`,
      message: `${it.document} of ${it.kind === "VEHICLE" ? "vehicle" : "driver"} ${it.name} ${it.daysLeft < 0 ? "expired on" : "expires on"} ${displayDate(it.expiryDate)}.`,
      entityType: it.kind, entityId: it.id, dueDate: toDate(it.expiryDate),
    });
  }
  const h = await backupHealth();
  if (h.reminder) {
    upserts.push({ key: `BACKUP:${today}:${h.reminderLevel}`, type: "BACKUP", severity: h.reminderLevel === "WARNING" ? "WARNING" : h.reminderLevel === "URGENT" ? "URGENT" : "CRITICAL", title: "Backup needed", message: h.reminder });
  }
  const lic = await currentLicense();
  if (lic.level !== "OK") {
    upserts.push({ key: `LICENSE:${lic.expiryDate}:${lic.level}:${lic.daysLeft !== null && lic.daysLeft <= 15 ? "15" : "30"}`, type: "LICENSE", severity: lic.level === "WARNING" ? "WARNING" : "CRITICAL", title: lic.level === "EXPIRED" ? "LICENSE EXPIRED" : "Licence expiring", message: lic.message });
  }
  for (const u of upserts) {
    await prisma.notification.upsert({ where: { key: u.key }, update: { title: u.title, message: u.message, severity: u.severity }, create: u });
  }
  return upserts.length;
}

export async function listNotifications(ctx: Ctx, q: any) {
  assertCan(ctx, "dashboard.view");
  const { skip, take, page, pageSize } = pageParams(q);
  const where: any = q.unread === "1" ? { readAt: null } : {};
  if (q.type) where.type = q.type;
  const [rows, total] = await Promise.all([prisma.notification.findMany({ where, skip, take, orderBy: [{ readAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }] }), prisma.notification.count({ where })]);
  return { rows: plain(rows), total, page, pageSize };
}

export async function markRead(ctx: Ctx, id: string | "all") {
  assertCan(ctx, "dashboard.view");
  if (id === "all") await prisma.notification.updateMany({ where: { readAt: null }, data: { readAt: new Date() } });
  else await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  return { ok: true };
}
