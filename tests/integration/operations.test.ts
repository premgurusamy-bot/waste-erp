import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { Ctx } from "@/server/context";
import { createEntity, updateEntity } from "@/server/services/masters";
import { assignSchedule, createCollection, createPickup, createSchedule, startSchedule } from "@/server/services/operations";
import { cancelWeighment, gateIn, gateOut, overrideNetWeight } from "@/server/services/weighments";
import { at, ctxFor, fixture, today, uniq } from "../helpers";

let admin: Ctx;
beforeAll(async () => {
  admin = await ctxFor("ADMIN");
});

describe("Customer", () => {
  it("creates a customer with an auto-generated code and an audit record", async () => {
    const c = await createEntity(admin, "customer", { name: uniq("ABC Industries"), gstin: "33AAACA1234B1Z2", mobile: "9876543210", creditDays: 30 });
    const rec = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
    expect(rec.code).toMatch(/^CUS-\d{5}$/);
    expect(rec.stateCode).toBe("33");
    const log = await prisma.auditLog.findFirst({ where: { module: "customers", recordId: c.id, action: "CREATE" } });
    expect(log?.userId).toBe(admin.userId);
  });

  it("rejects invalid input with field errors", async () => {
    await expect(createEntity(admin, "customer", { name: "", gstin: "WRONG" })).rejects.toThrow();
  });

  it("records previous and new values when a customer is modified", async () => {
    const c = await createEntity(admin, "customer", { name: uniq("Audit Co"), creditDays: 30 });
    await updateEntity(admin, "customer", c.id, { name: "Audit Co Renamed", creditDays: 45 });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { recordId: c.id, action: "UPDATE" } });
    expect(log.oldValues).toMatchObject({ creditDays: 30 });
    expect(log.newValues).toMatchObject({ name: "Audit Co Renamed", creditDays: 45 });
  });
});

describe("Pickup → schedule → collection", () => {
  it("moves through Pending → Assigned → In Progress → Completed", async () => {
    const f = await fixture(admin);
    const ops = await ctxFor("OPERATIONS");
    const p = await createPickup(ops, { customerId: f.customer.id, siteId: f.site.id, wasteTypeId: f.I.wasteType("DRY"), requestedDate: today(), priority: "HIGH" });
    expect(p.number).toMatch(/^PICK-\d{5}$/);
    expect(p.status).toBe("PENDING");

    const s = await createSchedule(ops, { pickupRequestId: p.id, customerId: f.customer.id, siteId: f.site.id, wasteTypeId: f.I.wasteType("DRY"), scheduledDate: today() });
    await assignSchedule(ops, { scheduleId: s.id, vehicleId: f.vehicle.id, driverId: f.driver.id });
    expect((await prisma.pickupRequest.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("ASSIGNED");
    await startSchedule(ops, s.id);
    expect((await prisma.pickupRequest.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("IN_PROGRESS");

    const col = await createCollection(ops, {
      scheduleId: s.id, customerId: f.customer.id, siteId: f.site.id, vehicleId: f.vehicle.id, driverId: f.driver.id,
      wasteTypeId: f.I.wasteType("DRY"), collectionDate: at(today()), actualQty: 3400, status: "COMPLETED",
    });
    expect(col.createdById).toBe(ops.userId);
    expect((await prisma.collectionSchedule.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("COMPLETED");
    expect((await prisma.pickupRequest.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("COMPLETED");
  });

  it("rejects a site that belongs to another customer", async () => {
    const a = await fixture(admin);
    const b = await fixture(admin);
    await expect(createPickup(admin, { customerId: a.customer.id, siteId: b.site.id, wasteTypeId: a.I.wasteType("DRY"), requestedDate: today() })).rejects.toThrow(/does not belong/);
  });
});

describe("Weighment", () => {
  it("calculates Net = Gross 8,540 − Tare 5,100 = 3,440 KG and receives it into stock", async () => {
    const f = await fixture(admin);
    const yard = f.I.location("YARD-1");
    const raw = await prisma.inventoryItem.findUniqueOrThrow({ where: { code: "RAW-DRY" } });
    const before = Number((await prisma.inventoryBalance.findUnique({ where: { itemId_locationId: { itemId: raw.id, locationId: yard } } }))?.quantity ?? 0);
    const weigh = await ctxFor("WEIGHBRIDGE");
    const w = await gateIn(weigh, { vehicleId: f.vehicle.id, customerId: f.customer.id, siteId: f.site.id, wasteTypeId: f.I.wasteType("DRY"), locationId: yard, gateInAt: at(today(), "08:10"), grossWeight: 8540, slipNumber: uniq("WB") });
    expect(w.number).toMatch(/^WT-\d{5}$/);
    // A client-supplied netWeight is ignored: the server always derives it.
    const done = await gateOut(weigh, { weighmentId: w.id, tareWeight: 5100, gateOutAt: at(today(), "08:55"), netWeight: 99999 } as any);
    expect(Number(done.netWeight)).toBe(3440);
    expect(Number(done.calculatedNetWeight)).toBe(3440);
    expect(done.status).toBe("COMPLETED");
    const after = Number((await prisma.inventoryBalance.findUniqueOrThrow({ where: { itemId_locationId: { itemId: raw.id, locationId: yard } } })).quantity);
    expect(after - before).toBe(3440);
  });

  it("rejects tare greater than gross, negative weights, duplicates and invalid vehicles", async () => {
    const f = await fixture(admin);
    const base = { vehicleId: f.vehicle.id, customerId: f.customer.id, wasteTypeId: f.I.wasteType("DRY"), locationId: f.I.location("YARD-1"), gateInAt: at(today()) };
    await expect(gateIn(admin, { ...base, grossWeight: -10 })).rejects.toThrow();
    await expect(gateIn(admin, { ...base, vehicleId: "does-not-exist", grossWeight: 5000 })).rejects.toThrow(/Invalid vehicle/);
    const slip = uniq("SLIP");
    const w = await gateIn(admin, { ...base, grossWeight: 5000, slipNumber: slip });
    // Same vehicle cannot gate in twice
    await expect(gateIn(admin, { ...base, grossWeight: 6000 })).rejects.toThrow(/already has an open weighment/);
    // Same slip number cannot be reused
    const other = await fixture(admin);
    await expect(gateIn(admin, { ...base, vehicleId: other.vehicle.id, grossWeight: 6000, slipNumber: slip })).rejects.toThrow(/already used/);
    // Tare > gross
    await expect(gateOut(admin, { weighmentId: w.id, tareWeight: 5100, gateOutAt: at(today(), "11:00") })).rejects.toThrow(/Tare weight must be less than gross/);
    await expect(gateOut(admin, { weighmentId: w.id, tareWeight: -1, gateOutAt: at(today(), "11:00") })).rejects.toThrow();
  });

  it("rejects an inactive vehicle", async () => {
    const f = await fixture(admin);
    await prisma.vehicle.update({ where: { id: f.vehicle.id }, data: { status: "INACTIVE" } });
    await expect(gateIn(admin, { vehicleId: f.vehicle.id, customerId: f.customer.id, wasteTypeId: f.I.wasteType("DRY"), locationId: f.I.location("YARD-1"), gateInAt: at(today()), grossWeight: 5000 })).rejects.toThrow(/inactive/);
  });

  it("only allows an admin override with a reason, and audits it", async () => {
    const f = await fixture(admin);
    const w = await gateIn(admin, { vehicleId: f.vehicle.id, customerId: f.customer.id, wasteTypeId: f.I.wasteType("DRY"), locationId: f.I.location("YARD-1"), gateInAt: at(today()), grossWeight: 8540 });
    await gateOut(admin, { weighmentId: w.id, tareWeight: 5100, gateOutAt: at(today(), "11:00") });
    const weigh = await ctxFor("WEIGHBRIDGE");
    await expect(overrideNetWeight(weigh, { weighmentId: w.id, netWeight: 3400, reason: "Scale error" })).rejects.toThrow(/permission/);
    await expect(overrideNetWeight(admin, { weighmentId: w.id, netWeight: 3400, reason: "" })).rejects.toThrow();
    const o = await overrideNetWeight(admin, { weighmentId: w.id, netWeight: 3400, reason: "Weighbridge calibration error" });
    expect(Number(o.netWeight)).toBe(3400);
    expect(Number(o.calculatedNetWeight)).toBe(3440);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { recordId: w.id, action: "OVERRIDE" } });
    expect(log.oldValues).toMatchObject({ netWeight: 3440 });
    expect(log.newValues).toMatchObject({ netWeight: 3400, reason: "Weighbridge calibration error" });
  });

  it("cancelling a completed weighment reverses its stock", async () => {
    const f = await fixture(admin);
    const yard = f.I.location("YARD-1");
    const raw = await prisma.inventoryItem.findUniqueOrThrow({ where: { code: "RAW-DRY" } });
    const bal = async () => Number((await prisma.inventoryBalance.findUnique({ where: { itemId_locationId: { itemId: raw.id, locationId: yard } } }))?.quantity ?? 0);
    const w = await gateIn(admin, { vehicleId: f.vehicle.id, customerId: f.customer.id, wasteTypeId: f.I.wasteType("DRY"), locationId: yard, gateInAt: at(today()), grossWeight: 7000 });
    await gateOut(admin, { weighmentId: w.id, tareWeight: 5000, gateOutAt: at(today(), "11:00") });
    const mid = await bal();
    await cancelWeighment(admin, w.id, "Wrong customer selected");
    expect(await bal()).toBe(mid - 2000);
    expect((await prisma.weighment.findUniqueOrThrow({ where: { id: w.id } })).status).toBe("CANCELLED");
  });
});
