"use server";

import { act } from "@/server/action";
import { createFuelEntry, createMaintenanceEntry } from "@/server/services/purchases";

export async function fuelAction(values: Record<string, unknown>) {
  return act((ctx) => createFuelEntry(ctx, values), ["/vehicles", "/expenses"]);
}
export async function maintenanceAction(values: Record<string, unknown>) {
  return act((ctx) => createMaintenanceEntry(ctx, values), ["/vehicles", "/expenses"]);
}
