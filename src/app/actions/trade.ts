"use server";

import { act } from "@/server/action";
import { cancelPurchase, cancelExpense, createExpense, createPurchase } from "@/server/services/purchases";
import { cancelSalesInvoice, createSalesInvoice } from "@/server/services/sales";

export async function salesAction(values: Record<string, unknown>) {
  return act((ctx) => createSalesInvoice(ctx, values), ["/sales", "/inventory", "/dashboard"]);
}
export async function cancelSalesAction(id: string, reason: string) {
  return act((ctx) => cancelSalesInvoice(ctx, id, reason), ["/sales", "/inventory"]);
}
export async function purchaseAction(values: Record<string, unknown>) {
  return act((ctx) => createPurchase(ctx, values), ["/purchases", "/inventory"]);
}
export async function cancelPurchaseAction(id: string, reason: string) {
  return act((ctx) => cancelPurchase(ctx, id, reason), ["/purchases", "/inventory"]);
}
export async function expenseAction(values: Record<string, unknown>) {
  return act((ctx) => createExpense(ctx, values), ["/expenses"]);
}
export async function cancelExpenseAction(id: string, reason: string) {
  return act((ctx) => cancelExpense(ctx, id, reason), ["/expenses"]);
}
