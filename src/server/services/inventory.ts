import { prisma } from "@/lib/db";
import { dateOnly } from "@/lib/utils";
import { stockMovementSchema } from "@/lib/validation";
import { audit } from "../audit";
import { assertCan, type Ctx } from "../context";
import { AppError } from "../errors";
import { postStock } from "../inventory";

/** Opening stock, transfers between locations, adjustments and disposal of rejected waste. */
export async function recordStockMovement(ctx: Ctx, input: unknown) {
  assertCan(ctx, "inventory.manage");
  const i = stockMovementSchema.parse(input);
  if (i.allowNegative) assertCan(ctx, "inventory.override");
  if (i.kind === "OPENING") assertCan(ctx, "inventory.override");
  const date = dateOnly(i.date);
  return prisma.$transaction(async (tx) => {
    const item = await tx.inventoryItem.findUnique({ where: { id: i.itemId } });
    if (!item) throw new AppError("Invalid material.");
    const ref = { refType: `STOCK_${i.kind}`, refId: `${i.kind}-${Date.now()}`, remarks: i.remarks ?? null, allowNegative: i.allowNegative };
    if (i.kind === "OPENING") {
      await postStock(tx, ctx, { date, itemId: i.itemId, locationId: i.locationId, quantity: i.quantity, txnType: "OPENING", ...ref });
    } else if (i.kind === "TRANSFER") {
      await postStock(tx, ctx, { date, itemId: i.itemId, locationId: i.locationId, quantity: -i.quantity, txnType: "TRANSFER_OUT", ...ref });
      await postStock(tx, ctx, { date, itemId: i.itemId, locationId: i.toLocationId!, quantity: i.quantity, txnType: "TRANSFER_IN", ...ref });
    } else if (i.kind === "ADJUSTMENT") {
      await postStock(tx, ctx, { date, itemId: i.itemId, locationId: i.locationId, quantity: i.quantity, txnType: "ADJUSTMENT", ...ref });
    } else {
      await postStock(tx, ctx, { date, itemId: i.itemId, locationId: i.locationId, quantity: -i.quantity, txnType: "DISPOSAL", ...ref });
    }
    await audit(tx, ctx, {
      action: i.allowNegative ? "OVERRIDE" : "CREATE",
      module: "inventory",
      recordId: ref.refId,
      recordLabel: `${i.kind} ${item.name}`,
      newValues: i,
    });
    return { ok: true };
  });
}
