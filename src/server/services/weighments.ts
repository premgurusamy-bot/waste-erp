import { prisma, type Tx } from "@/lib/db";
import { localDateTime, round3 } from "@/lib/utils";
import { gateInSchema, gateOutSchema, netOverrideSchema } from "@/lib/validation";
import { audit } from "../audit";
import { assertCan, type Ctx } from "../context";
import { AppError } from "../errors";
import { postStock, reverseStock } from "../inventory";
import { nextNumber } from "../numbering";

/** Net weight is always derived; it is never accepted from the client during normal entry. */
export function calculateNetWeight(gross: number, tare: number): number {
  if (!(gross > 0)) throw new AppError("Gross weight must be greater than zero.", { grossWeight: "Must be > 0" });
  if (tare < 0) throw new AppError("Tare weight cannot be negative.", { tareWeight: "Cannot be negative" });
  if (tare >= gross) throw new AppError("Tare weight must be less than gross weight.", { tareWeight: "Tare must be less than gross" });
  return round3(gross - tare);
}

async function rawItemFor(tx: Tx, wasteTypeId: string) {
  const item = await tx.inventoryItem.findFirst({ where: { wasteTypeId, itemType: "RAW" } });
  if (!item) throw new AppError("No unprocessed stock item is configured for this waste type. Ask the administrator to set it up in Master Data.");
  return item;
}

export async function gateIn(ctx: Ctx, input: unknown) {
  assertCan(ctx, "weighments.manage");
  const i = gateInSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.findUnique({ where: { id: i.vehicleId } });
    if (!vehicle) throw new AppError("Invalid vehicle.", { vehicleId: "Invalid vehicle" });
    if (vehicle.status === "INACTIVE") throw new AppError(`Vehicle ${vehicle.number} is inactive.`, { vehicleId: "Inactive vehicle" });
    const open = await tx.weighment.findFirst({ where: { vehicleId: i.vehicleId, status: "GATE_IN" } });
    if (open) throw new AppError(`Vehicle ${vehicle.number} already has an open weighment (${open.number}). Complete gate-out first.`, { vehicleId: "Open weighment exists" });
    const customer = await tx.customer.findUnique({ where: { id: i.customerId } });
    if (!customer || customer.status !== "ACTIVE") throw new AppError("Select an active customer.", { customerId: "Invalid customer" });
    if (i.siteId) {
      const site = await tx.customerSite.findUnique({ where: { id: i.siteId } });
      if (!site || site.customerId !== i.customerId) throw new AppError("The site does not belong to this customer.", { siteId: "Wrong site" });
    }
    if (i.slipNumber) {
      const dup = await tx.weighment.findFirst({ where: { slipNumber: i.slipNumber, status: { not: "CANCELLED" } } });
      if (dup) throw new AppError(`Weighbridge slip ${i.slipNumber} is already used on ${dup.number}.`, { slipNumber: "Duplicate slip" });
    }
    if (i.collectionEntryId) {
      const used = await tx.weighment.findFirst({ where: { collectionEntryId: i.collectionEntryId, status: { not: "CANCELLED" } } });
      if (used) throw new AppError(`This collection is already weighed (${used.number}).`, { collectionEntryId: "Already weighed" });
      // A cancelled weighment may still hold the unique link; release it.
      await tx.weighment.updateMany({ where: { collectionEntryId: i.collectionEntryId, status: "CANCELLED" }, data: { collectionEntryId: null } });
    }
    await rawItemFor(tx, i.wasteTypeId);
    const number = await nextNumber(tx, "WEIGHMENT");
    const w = await tx.weighment.create({
      data: {
        number,
        collectionEntryId: i.collectionEntryId ?? null,
        vehicleId: i.vehicleId,
        driverId: i.driverId ?? null,
        customerId: i.customerId,
        siteId: i.siteId ?? null,
        wasteTypeId: i.wasteTypeId,
        locationId: i.locationId,
        gateInAt: localDateTime(i.gateInAt),
        grossWeight: i.grossWeight,
        slipNumber: i.slipNumber ?? null,
        remarks: i.remarks ?? null,
        createdById: ctx.userId,
      },
    });
    await audit(tx, ctx, { action: "CREATE", module: "weighments", recordId: w.id, recordLabel: `${w.number} gate-in ${vehicle.number}`, newValues: w });
    return w;
  });
}

export async function gateOut(ctx: Ctx, input: unknown) {
  assertCan(ctx, "weighments.manage");
  const i = gateOutSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const w = await tx.weighment.findUnique({ where: { id: i.weighmentId } });
    if (!w) throw new AppError("Weighment not found.");
    if (w.status !== "GATE_IN") throw new AppError("This weighment is already completed or cancelled.");
    const gross = Number(w.grossWeight);
    const net = calculateNetWeight(gross, i.tareWeight);
    const gateOutAt = localDateTime(i.gateOutAt);
    if (gateOutAt < w.gateInAt) throw new AppError("Gate-out time cannot be before gate-in time.", { gateOutAt: "Before gate-in" });
    const u = await tx.weighment.update({
      where: { id: w.id },
      data: {
        tareWeight: i.tareWeight,
        gateOutAt,
        calculatedNetWeight: net,
        netWeight: net,
        status: "COMPLETED",
        remarks: i.remarks ?? w.remarks,
        completedById: ctx.userId,
      },
    });
    const item = await rawItemFor(tx, w.wasteTypeId);
    await postStock(tx, ctx, {
      date: gateOutAt,
      itemId: item.id,
      locationId: w.locationId,
      quantity: net,
      txnType: "RECEIPT",
      refType: "WEIGHMENT",
      refId: w.id,
      refNumber: w.number,
      remarks: "Waste received at weighbridge",
    });
    await audit(tx, ctx, {
      action: "COMPLETE",
      module: "weighments",
      recordId: w.id,
      recordLabel: `${w.number} gate-out`,
      oldValues: { status: "GATE_IN" },
      newValues: { grossWeight: gross, tareWeight: i.tareWeight, netWeight: net, status: "COMPLETED" },
    });
    return u;
  });
}

/** Admin-only manual override of the calculated net weight. Requires a reason; always audited. */
export async function overrideNetWeight(ctx: Ctx, input: unknown) {
  assertCan(ctx, "weighments.override");
  const i = netOverrideSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const w = await tx.weighment.findUnique({ where: { id: i.weighmentId } });
    if (!w || w.status !== "COMPLETED") throw new AppError("Only completed weighments can be overridden.");
    if (w.customerInvoiceItemId) throw new AppError("This weighment is already billed. Cancel the invoice first.");
    if (i.netWeight > Number(w.grossWeight)) throw new AppError("Net weight cannot exceed gross weight.", { netWeight: "Exceeds gross" });
    const old = Number(w.netWeight);
    const delta = round3(i.netWeight - old);
    const u = await tx.weighment.update({
      where: { id: w.id },
      data: { netWeight: i.netWeight, isNetOverridden: true, overrideReason: i.reason },
    });
    if (delta !== 0) {
      const item = await rawItemFor(tx, w.wasteTypeId);
      await postStock(tx, ctx, {
        date: w.gateOutAt ?? new Date(),
        itemId: item.id,
        locationId: w.locationId,
        quantity: delta,
        txnType: "ADJUSTMENT",
        refType: "WEIGHMENT",
        refId: w.id,
        refNumber: w.number,
        remarks: `Net weight override: ${i.reason}`,
      });
    }
    await audit(tx, ctx, {
      action: "OVERRIDE",
      module: "weighments",
      recordId: w.id,
      recordLabel: `${w.number} net weight override`,
      oldValues: { netWeight: old, calculatedNetWeight: Number(w.calculatedNetWeight) },
      newValues: { netWeight: i.netWeight, reason: i.reason },
    });
    return u;
  });
}

export async function cancelWeighment(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "weighments.manage");
  if (!reason || reason.trim().length < 3) throw new AppError("Enter a cancellation reason.");
  return prisma.$transaction(async (tx) => {
    const w = await tx.weighment.findUnique({ where: { id } });
    if (!w) throw new AppError("Weighment not found.");
    if (w.status === "CANCELLED") throw new AppError("Already cancelled.");
    if (w.customerInvoiceItemId) throw new AppError("This weighment is billed. Cancel the invoice first.");
    if (w.status === "COMPLETED") await reverseStock(tx, ctx, "WEIGHMENT", w.id, reason);
    const u = await tx.weighment.update({ where: { id }, data: { status: "CANCELLED", cancelReason: reason } });
    await audit(tx, ctx, { action: "CANCEL", module: "weighments", recordId: id, recordLabel: w.number, oldValues: { status: w.status }, newValues: { status: "CANCELLED", reason } });
    return u;
  });
}
