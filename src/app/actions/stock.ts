"use server";

import { act } from "@/server/action";
import { recordStockMovement } from "@/server/services/inventory";
import { cancelProcessingBatch, createProcessingBatch } from "@/server/services/processing";

const P = ["/processing", "/inventory", "/dashboard"];

export async function processingAction(values: Record<string, unknown>) {
  return act((ctx) => createProcessingBatch(ctx, values), P);
}
export async function cancelProcessingAction(id: string, reason: string) {
  return act((ctx) => cancelProcessingBatch(ctx, id, reason), P);
}
export async function stockMovementAction(values: Record<string, unknown>) {
  return act((ctx) => recordStockMovement(ctx, values), P);
}
