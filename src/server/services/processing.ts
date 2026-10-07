import { prisma } from "@/lib/db";
import { dateOnly, round3 } from "@/lib/utils";
import { processingSchema } from "@/lib/validation";
import { audit } from "../audit";
import { assertCan, type Ctx } from "../context";
import { AppError } from "../errors";
import { postStock, reverseStock } from "../inventory";
import { nextNumber } from "../numbering";

export const REJECT_ITEM_CODE = "REJECT";

/** INPUT must equal OUTPUT + REJECTED + LOSS (to the gram). */
export function checkProcessingBalance(input: number, output: number, rejected: number, loss: number) {
  const diffKg = round3(input - (output + rejected + loss));
  if (diffKg !== 0) {
    throw new AppError(
      `Quantities do not balance. Input ${round3(input)} KG must equal Output ${round3(output)} + Rejected ${round3(rejected)} + Loss ${round3(loss)} KG. Unexplained difference: ${diffKg} KG.`,
      { lossQty: `Unexplained difference ${diffKg} KG` },
    );
  }
}

export async function createProcessingBatch(ctx: Ctx, input: unknown) {
  assertCan(ctx, "processing.manage");
  const i = processingSchema.parse(input);
  const inputQty = round3(i.inputs.reduce((s, l) => s + l.quantity, 0));
  const outputQty = round3(i.outputs.reduce((s, l) => s + l.quantity, 0));
  checkProcessingBalance(inputQty, outputQty, i.rejectedQty, i.lossQty);

  return prisma.$transaction(async (tx) => {
    const itemIds = [...i.inputs, ...i.outputs].map((l) => l.itemId);
    const items = await tx.inventoryItem.findMany({ where: { id: { in: itemIds } } });
    const byId = new Map(items.map((x) => [x.id, x]));
    for (const l of i.outputs) {
      const it = byId.get(l.itemId);
      if (!it || !["RECOVERED", "OTHER"].includes(it.itemType)) throw new AppError("Outputs must be recovered materials.");
    }
    for (const l of i.inputs) if (!byId.get(l.itemId)) throw new AppError("Invalid input material.");
    const rejectItem = await tx.inventoryItem.findUnique({ where: { code: REJECT_ITEM_CODE } });
    if (i.rejectedQty > 0 && !rejectItem) throw new AppError("The rejected-waste stock item (REJECT) is not configured.");

    const date = dateOnly(i.date);
    const number = await nextNumber(tx, "PROCESSING");
    const batch = await tx.processingBatch.create({
      data: {
        number,
        batchNo: i.batchNo,
        date,
        locationId: i.locationId,
        inputQty,
        outputQty,
        rejectedQty: i.rejectedQty,
        lossQty: i.lossQty,
        remarks: i.remarks ?? null,
        createdById: ctx.userId,
        inputs: { create: i.inputs.map((l) => ({ itemId: l.itemId, quantity: l.quantity })) },
        outputs: { create: i.outputs.map((l) => ({ itemId: l.itemId, quantity: l.quantity })) },
      },
    });
    const ref = { refType: "PROCESSING", refId: batch.id, refNumber: number };
    for (const l of i.inputs) {
      await postStock(tx, ctx, { date, itemId: l.itemId, locationId: i.locationId, quantity: -l.quantity, txnType: "PROCESS_ISSUE", ...ref, remarks: `Issued to batch ${i.batchNo}` });
    }
    for (const l of i.outputs) {
      await postStock(tx, ctx, { date, itemId: l.itemId, locationId: i.locationId, quantity: l.quantity, txnType: "RECOVERY", ...ref, remarks: `Recovered in batch ${i.batchNo}` });
    }
    if (i.rejectedQty > 0) {
      await postStock(tx, ctx, { date, itemId: rejectItem!.id, locationId: i.locationId, quantity: i.rejectedQty, txnType: "REJECTION", ...ref, remarks: `Rejected in batch ${i.batchNo}` });
    }
    await audit(tx, ctx, {
      action: "CREATE",
      module: "processing",
      recordId: batch.id,
      recordLabel: `${number} (${i.batchNo})`,
      newValues: { inputQty, outputQty, rejectedQty: i.rejectedQty, lossQty: i.lossQty, inputs: i.inputs, outputs: i.outputs },
    });
    return batch;
  });
}

export async function cancelProcessingBatch(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "processing.manage");
  if (!reason || reason.trim().length < 3) throw new AppError("Enter a cancellation reason.");
  return prisma.$transaction(async (tx) => {
    const b = await tx.processingBatch.findUnique({ where: { id } });
    if (!b || b.status === "CANCELLED") throw new AppError("Batch not found or already cancelled.");
    await reverseStock(tx, ctx, "PROCESSING", b.id, reason);
    const u = await tx.processingBatch.update({ where: { id }, data: { status: "CANCELLED", cancelReason: reason } });
    await audit(tx, ctx, { action: "CANCEL", module: "processing", recordId: id, recordLabel: b.number, oldValues: { status: b.status }, newValues: { status: "CANCELLED", reason } });
    return u;
  });
}
