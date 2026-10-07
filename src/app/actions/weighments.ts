"use server";

import { act } from "@/server/action";
import { cancelWeighment, gateIn, gateOut, overrideNetWeight } from "@/server/services/weighments";

const P = ["/weighments", "/collections", "/inventory", "/dashboard"];

export async function gateInAction(values: Record<string, unknown>) {
  return act((ctx) => gateIn(ctx, values), P);
}
export async function gateOutAction(values: Record<string, unknown>) {
  return act((ctx) => gateOut(ctx, values), P);
}
export async function overrideNetAction(values: Record<string, unknown>) {
  return act((ctx) => overrideNetWeight(ctx, values), P);
}
export async function cancelWeighmentAction(id: string, reason: string) {
  return act((ctx) => cancelWeighment(ctx, id, reason), P);
}
