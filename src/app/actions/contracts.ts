"use server";

import { act } from "@/server/action";
import { addRate, cancelRate, createContract, reviseRate, updateContract } from "@/server/services/contracts";

export async function saveContractAction(id: string | null, values: Record<string, unknown>) {
  return act((ctx) => (id ? updateContract(ctx, id, values) : createContract(ctx, values)), ["/contracts"]);
}
export async function addRateAction(values: Record<string, unknown>) {
  return act((ctx) => addRate(ctx, values), ["/contracts"]);
}
export async function reviseRateAction(values: Record<string, unknown>) {
  return act((ctx) => reviseRate(ctx, values), ["/contracts"]);
}
export async function cancelRateAction(rateId: string, reason: string) {
  return act((ctx) => cancelRate(ctx, rateId, reason), ["/contracts"]);
}
