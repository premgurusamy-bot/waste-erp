import { prisma, type Tx } from "@/lib/db";
import { dateOnly, localDateTime, todayISO } from "@/lib/utils";
import { assignSchema, collectionSchema, pickupSchema, rescheduleSchema, scheduleSchema } from "@/lib/validation";
import { audit, diff } from "../audit";
import { assertCan, type Ctx } from "../context";
import { AppError } from "../errors";
import { nextNumber } from "../numbering";

async function checkSite(tx: Tx, customerId: string, siteId: string) {
  const site = await tx.customerSite.findUnique({ where: { id: siteId }, include: { customer: true } });
  if (!site || site.customerId !== customerId) throw new AppError("The selected site does not belong to the selected customer.", { siteId: "Wrong site" });
  if (site.status !== "ACTIVE" || site.customer.status !== "ACTIVE") throw new AppError("The customer or site is inactive.");
  return site;
}

async function checkVehicleDriver(tx: Tx, vehicleId?: string | null, driverId?: string | null) {
  if (vehicleId) {
    const v = await tx.vehicle.findUnique({ where: { id: vehicleId } });
    if (!v) throw new AppError("Invalid vehicle.", { vehicleId: "Invalid vehicle" });
    if (v.status !== "ACTIVE") throw new AppError(`Vehicle ${v.number} is not active (${v.status.replace("_", " ").toLowerCase()}).`, { vehicleId: "Vehicle not active" });
  }
  if (driverId) {
    const dr = await tx.driver.findUnique({ where: { id: driverId } });
    if (!dr) throw new AppError("Invalid driver.", { driverId: "Invalid driver" });
    if (dr.status !== "ACTIVE") throw new AppError(`Driver ${dr.name} is inactive.`, { driverId: "Driver inactive" });
  }
}

// ----------------------------- PICKUPS --------------------------------

export async function createPickup(ctx: Ctx, input: unknown) {
  assertCan(ctx, "pickups.manage");
  const i = pickupSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await checkSite(tx, i.customerId, i.siteId);
    const number = await nextNumber(tx, "PICKUP");
    const p = await tx.pickupRequest.create({
      data: {
        number,
        customerId: i.customerId,
        siteId: i.siteId,
        wasteTypeId: i.wasteTypeId,
        requestedDate: dateOnly(i.requestedDate),
        requestedTime: i.requestedTime ?? null,
        priority: i.priority,
        estimatedQty: i.estimatedQty ?? null,
        remarks: i.remarks ?? null,
        createdById: ctx.userId,
      },
    });
    await audit(tx, ctx, { action: "CREATE", module: "pickups", recordId: p.id, recordLabel: p.number, newValues: p });
    return p;
  });
}

export async function updatePickup(ctx: Ctx, id: string, input: unknown) {
  assertCan(ctx, "pickups.manage");
  const i = pickupSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const before = await tx.pickupRequest.findUnique({ where: { id } });
    if (!before) throw new AppError("Pickup not found.");
    if (before.status !== "PENDING") throw new AppError("Only pending pickups can be edited.");
    await checkSite(tx, i.customerId, i.siteId);
    const p = await tx.pickupRequest.update({
      where: { id },
      data: {
        customerId: i.customerId,
        siteId: i.siteId,
        wasteTypeId: i.wasteTypeId,
        requestedDate: dateOnly(i.requestedDate),
        requestedTime: i.requestedTime ?? null,
        priority: i.priority,
        estimatedQty: i.estimatedQty ?? null,
        remarks: i.remarks ?? null,
      },
    });
    const ch = diff(before, p);
    await audit(tx, ctx, { action: "UPDATE", module: "pickups", recordId: id, recordLabel: p.number, oldValues: ch.before, newValues: ch.after });
    return p;
  });
}

export async function cancelPickup(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "pickups.manage");
  if (!reason || reason.trim().length < 3) throw new AppError("Enter a cancellation reason.");
  return prisma.$transaction(async (tx) => {
    const p = await tx.pickupRequest.findUnique({ where: { id } });
    if (!p) throw new AppError("Pickup not found.");
    if (p.status === "COMPLETED" || p.status === "CANCELLED") throw new AppError(`A ${p.status.toLowerCase()} pickup cannot be cancelled.`);
    const inProgress = await tx.collectionSchedule.count({ where: { pickupRequestId: id, status: "IN_PROGRESS" } });
    if (inProgress) throw new AppError("Collection is in progress for this pickup. Cancel or complete the schedule first.");
    await tx.collectionSchedule.updateMany({
      where: { pickupRequestId: id, status: { in: ["SCHEDULED", "ASSIGNED"] } },
      data: { status: "CANCELLED", cancelReason: `Pickup cancelled: ${reason}` },
    });
    const u = await tx.pickupRequest.update({ where: { id }, data: { status: "CANCELLED", cancelReason: reason } });
    await audit(tx, ctx, { action: "CANCEL", module: "pickups", recordId: id, recordLabel: p.number, oldValues: { status: p.status }, newValues: { status: "CANCELLED", reason } });
    return u;
  });
}

// ----------------------------- SCHEDULES ------------------------------

export async function createSchedule(ctx: Ctx, input: unknown) {
  assertCan(ctx, "pickups.manage");
  const i = scheduleSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await checkSite(tx, i.customerId, i.siteId);
    await checkVehicleDriver(tx, i.vehicleId, i.driverId);
    if (i.pickupRequestId) {
      const p = await tx.pickupRequest.findUnique({ where: { id: i.pickupRequestId } });
      if (!p || ["COMPLETED", "CANCELLED"].includes(p.status)) throw new AppError("This pickup is already closed.");
      const open = await tx.collectionSchedule.count({ where: { pickupRequestId: p.id, status: { not: "CANCELLED" } } });
      if (open) throw new AppError("This pickup is already scheduled. Reschedule the existing schedule instead.");
    }
    const assigned = !!(i.vehicleId && i.driverId);
    const number = await nextNumber(tx, "SCHEDULE");
    const s = await tx.collectionSchedule.create({
      data: {
        number,
        pickupRequestId: i.pickupRequestId ?? null,
        customerId: i.customerId,
        siteId: i.siteId,
        wasteTypeId: i.wasteTypeId,
        scheduledDate: dateOnly(i.scheduledDate),
        scheduledTime: i.scheduledTime ?? null,
        vehicleId: i.vehicleId ?? null,
        driverId: i.driverId ?? null,
        status: assigned ? "ASSIGNED" : "SCHEDULED",
        remarks: i.remarks ?? null,
        createdById: ctx.userId,
      },
    });
    if (i.pickupRequestId && assigned) await tx.pickupRequest.update({ where: { id: i.pickupRequestId }, data: { status: "ASSIGNED" } });
    await audit(tx, ctx, { action: "CREATE", module: "pickups", recordId: s.id, recordLabel: s.number, newValues: s });
    return s;
  });
}

/** Create a schedule for the given date for every active DAILY site that has none yet. */
export async function generateDailySchedules(ctx: Ctx, dateISO: string = todayISO()) {
  assertCan(ctx, "pickups.manage");
  const date = dateOnly(dateISO);
  return prisma.$transaction(async (tx) => {
    const sites = await tx.customerSite.findMany({
      where: { status: "ACTIVE", frequency: "DAILY", defaultWasteTypeId: { not: null }, customer: { status: "ACTIVE" } },
    });
    let created = 0;
    for (const site of sites) {
      const exists = await tx.collectionSchedule.count({ where: { siteId: site.id, scheduledDate: date, status: { not: "CANCELLED" } } });
      if (exists) continue;
      const number = await nextNumber(tx, "SCHEDULE");
      const s = await tx.collectionSchedule.create({
        data: {
          number,
          customerId: site.customerId,
          siteId: site.id,
          wasteTypeId: site.defaultWasteTypeId!,
          scheduledDate: date,
          scheduledTime: site.collectionTime,
          remarks: "Auto-generated from site collection frequency",
          createdById: ctx.userId,
        },
      });
      await audit(tx, ctx, { action: "CREATE", module: "pickups", recordId: s.id, recordLabel: s.number, newValues: { auto: true, date: dateISO } });
      created++;
    }
    return { created };
  });
}

export async function assignSchedule(ctx: Ctx, input: unknown) {
  assertCan(ctx, "pickups.manage");
  const i = assignSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const s = await tx.collectionSchedule.findUnique({ where: { id: i.scheduleId } });
    if (!s) throw new AppError("Schedule not found.");
    if (["COMPLETED", "CANCELLED", "IN_PROGRESS"].includes(s.status)) throw new AppError(`Cannot reassign a ${s.status.toLowerCase().replace("_", " ")} schedule.`);
    await checkVehicleDriver(tx, i.vehicleId, i.driverId);
    const u = await tx.collectionSchedule.update({
      where: { id: s.id },
      data: { vehicleId: i.vehicleId, driverId: i.driverId, status: "ASSIGNED" },
    });
    if (s.pickupRequestId) await tx.pickupRequest.update({ where: { id: s.pickupRequestId }, data: { status: "ASSIGNED" } });
    await audit(tx, ctx, {
      action: "ASSIGN",
      module: "pickups",
      recordId: s.id,
      recordLabel: s.number,
      oldValues: { vehicleId: s.vehicleId, driverId: s.driverId, status: s.status },
      newValues: { vehicleId: u.vehicleId, driverId: u.driverId, status: u.status },
    });
    return u;
  });
}

export async function rescheduleSchedule(ctx: Ctx, input: unknown) {
  assertCan(ctx, "pickups.manage");
  const i = rescheduleSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const s = await tx.collectionSchedule.findUnique({ where: { id: i.scheduleId } });
    if (!s) throw new AppError("Schedule not found.");
    if (!["SCHEDULED", "ASSIGNED"].includes(s.status)) throw new AppError("Only scheduled or assigned collections can be rescheduled.");
    const u = await tx.collectionSchedule.update({
      where: { id: s.id },
      data: {
        scheduledDate: dateOnly(i.scheduledDate),
        scheduledTime: i.scheduledTime ?? s.scheduledTime,
        rescheduleCount: { increment: 1 },
        remarks: i.remarks ?? s.remarks,
      },
    });
    await audit(tx, ctx, {
      action: "UPDATE",
      module: "pickups",
      recordId: s.id,
      recordLabel: `${s.number} rescheduled`,
      oldValues: { scheduledDate: s.scheduledDate, scheduledTime: s.scheduledTime },
      newValues: { scheduledDate: u.scheduledDate, scheduledTime: u.scheduledTime },
    });
    return u;
  });
}

export async function startSchedule(ctx: Ctx, scheduleId: string) {
  if (!ctx.permissions.has("pickups.manage")) assertCan(ctx, "collections.manage");
  return prisma.$transaction(async (tx) => {
    const s = await tx.collectionSchedule.findUnique({ where: { id: scheduleId } });
    if (!s) throw new AppError("Schedule not found.");
    if (s.status !== "ASSIGNED") throw new AppError("Assign a vehicle and driver before starting the collection.");
    const u = await tx.collectionSchedule.update({ where: { id: s.id }, data: { status: "IN_PROGRESS", startedAt: new Date() } });
    if (s.pickupRequestId) await tx.pickupRequest.update({ where: { id: s.pickupRequestId }, data: { status: "IN_PROGRESS" } });
    await audit(tx, ctx, { action: "STATUS_CHANGE", module: "pickups", recordId: s.id, recordLabel: s.number, oldValues: { status: s.status }, newValues: { status: "IN_PROGRESS" } });
    return u;
  });
}

export async function cancelSchedule(ctx: Ctx, scheduleId: string, reason: string) {
  assertCan(ctx, "pickups.manage");
  if (!reason || reason.trim().length < 3) throw new AppError("Enter a cancellation reason.");
  return prisma.$transaction(async (tx) => {
    const s = await tx.collectionSchedule.findUnique({ where: { id: scheduleId } });
    if (!s) throw new AppError("Schedule not found.");
    if (["COMPLETED", "CANCELLED"].includes(s.status)) throw new AppError(`A ${s.status.toLowerCase()} schedule cannot be cancelled.`);
    const u = await tx.collectionSchedule.update({ where: { id: s.id }, data: { status: "CANCELLED", cancelReason: reason } });
    // The pickup goes back to pending so it can be rescheduled.
    if (s.pickupRequestId) await tx.pickupRequest.update({ where: { id: s.pickupRequestId }, data: { status: "PENDING" } });
    await audit(tx, ctx, { action: "CANCEL", module: "pickups", recordId: s.id, recordLabel: s.number, oldValues: { status: s.status }, newValues: { status: "CANCELLED", reason } });
    return u;
  });
}

// ----------------------------- COLLECTIONS ----------------------------

export async function createCollection(ctx: Ctx, input: unknown) {
  assertCan(ctx, "collections.manage");
  const i = collectionSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await checkSite(tx, i.customerId, i.siteId);
    await checkVehicleDriver(tx, i.vehicleId, i.driverId);
    let schedule = null;
    if (i.scheduleId) {
      schedule = await tx.collectionSchedule.findUnique({ where: { id: i.scheduleId }, include: { collectionEntry: true } });
      if (!schedule) throw new AppError("Schedule not found.");
      if (schedule.collectionEntry) throw new AppError("Collection has already been recorded for this schedule.");
      if (schedule.status === "CANCELLED") throw new AppError("This schedule was cancelled.");
      if (schedule.siteId !== i.siteId) throw new AppError("Site does not match the schedule.");
    }
    if (i.status !== "NOT_COLLECTED" && (i.actualQty === undefined || i.actualQty <= 0) && (i.estimatedQty === undefined || i.estimatedQty <= 0)) {
      throw new AppError("Enter the estimated or actual quantity collected.", { actualQty: "Required" });
    }
    const number = await nextNumber(tx, "COLLECTION");
    const c = await tx.collectionEntry.create({
      data: {
        number,
        scheduleId: i.scheduleId ?? null,
        customerId: i.customerId,
        siteId: i.siteId,
        vehicleId: i.vehicleId,
        driverId: i.driverId ?? null,
        wasteTypeId: i.wasteTypeId,
        collectionDate: localDateTime(i.collectionDate),
        estimatedQty: i.estimatedQty ?? null,
        actualQty: i.actualQty ?? null,
        status: i.status,
        remarks: i.remarks ?? null,
        photoDocumentId: i.photoDocumentId ?? null,
        latitude: i.latitude ?? null,
        longitude: i.longitude ?? null,
        createdById: ctx.userId,
      },
    });
    if (i.photoDocumentId) {
      await tx.document.update({ where: { id: i.photoDocumentId }, data: { entityType: "collection", entityId: c.id } });
    }
    if (schedule) {
      await tx.collectionSchedule.update({
        where: { id: schedule.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          startedAt: schedule.startedAt ?? new Date(),
          vehicleId: i.vehicleId,
          driverId: i.driverId ?? schedule.driverId,
        },
      });
      if (schedule.pickupRequestId) await tx.pickupRequest.update({ where: { id: schedule.pickupRequestId }, data: { status: "COMPLETED" } });
    }
    await audit(tx, ctx, { action: "CREATE", module: "collections", recordId: c.id, recordLabel: c.number, newValues: c });
    return c;
  });
}
