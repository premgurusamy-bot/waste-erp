import type { InventoryTxnType } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { round3 } from "@/lib/utils";
import type { Ctx } from "./context";
import { can } from "./context";
import { AppError } from "./errors";

export type StockMove = {
  date: Date;
  itemId: string;
  locationId: string;
  quantity: number; // signed: + in, - out
  txnType: InventoryTxnType;
  rate?: number | null;
  refType?: string;
  refId?: string;
  refNumber?: string;
  remarks?: string | null;
  isReversal?: boolean;
  /** Admin explicitly allows the balance to go negative (requires inventory.override). */
  allowNegative?: boolean;
};

/**
 * Post a stock movement and update the running balance atomically.
 * Throws (rolling back the surrounding transaction) if stock would go negative.
 */
export async function postStock(tx: Tx, ctx: Ctx, move: StockMove) {
  const qty = round3(move.quantity);
  if (qty === 0) return;
  await tx.$executeRaw`INSERT INTO inventory_balances ("id","itemId","locationId","quantity","updatedAt")
    VALUES (${`bal_${move.itemId}_${move.locationId}`}, ${move.itemId}, ${move.locationId}, 0, now())
    ON CONFLICT ("itemId","locationId") DO NOTHING`;
  const rows = await tx.$queryRaw<{ quantity: string }[]>`
    UPDATE inventory_balances SET "quantity" = "quantity" + ${qty}::numeric, "updatedAt" = now()
    WHERE "itemId" = ${move.itemId} AND "locationId" = ${move.locationId}
    RETURNING "quantity"::text AS quantity`;
  const after = Number(rows[0].quantity);
  if (after < 0 && qty < 0) {
    const item = await tx.inventoryItem.findUnique({ where: { id: move.itemId } });
    const overrideOk = move.allowNegative && can(ctx, "inventory.override");
    if (!item?.allowNegative && !overrideOk) {
      const loc = await tx.location.findUnique({ where: { id: move.locationId } });
      const available = round3(after - qty);
      throw new AppError(
        `Insufficient stock of ${item?.name ?? "item"} at ${loc?.name ?? "location"}. Available: ${available} ${item?.unit ?? ""}, required: ${Math.abs(qty)} ${item?.unit ?? ""}.`,
      );
    }
  }
  await tx.inventoryTransaction.create({
    data: {
      date: move.date,
      itemId: move.itemId,
      locationId: move.locationId,
      txnType: move.txnType,
      quantity: qty,
      rate: move.rate ?? null,
      refType: move.refType,
      refId: move.refId,
      refNumber: move.refNumber,
      remarks: move.remarks ?? null,
      isReversal: move.isReversal ?? false,
      createdById: ctx.userId,
    },
  });
}

/** Reverse every stock movement posted for a source document (used on cancel). */
export async function reverseStock(tx: Tx, ctx: Ctx, refType: string, refId: string, reason: string) {
  const txns = await tx.inventoryTransaction.findMany({ where: { refType, refId, isReversal: false } });
  for (const t of txns) {
    await postStock(tx, ctx, {
      date: t.date,
      itemId: t.itemId,
      locationId: t.locationId,
      quantity: -Number(t.quantity),
      txnType: t.txnType,
      refType,
      refId,
      refNumber: t.refNumber ?? undefined,
      remarks: `Reversal: ${reason}`,
      isReversal: true,
    });
  }
}

export async function availableStock(tx: Tx, itemId: string, locationId: string): Promise<number> {
  const bal = await tx.inventoryBalance.findUnique({ where: { itemId_locationId: { itemId, locationId } } });
  return bal ? Number(bal.quantity) : 0;
}
