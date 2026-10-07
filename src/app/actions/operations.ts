"use server";

import { act } from "@/server/action";
import {
  assignSchedule, cancelPickup, cancelSchedule, createCollection, createPickup, createSchedule,
  generateDailySchedules, rescheduleSchedule, startSchedule, updatePickup,
} from "@/server/services/operations";

const P = ["/pickups", "/schedule", "/collections", "/field", "/dashboard"];

export async function savePickupAction(id: string | null, values: Record<string, unknown>) {
  return act((ctx) => (id ? updatePickup(ctx, id, values) : createPickup(ctx, values)), P);
}
export async function cancelPickupAction(id: string, reason: string) {
  return act((ctx) => cancelPickup(ctx, id, reason), P);
}
export async function createScheduleAction(values: Record<string, unknown>) {
  return act((ctx) => createSchedule(ctx, values), P);
}
export async function assignScheduleAction(values: Record<string, unknown>) {
  return act((ctx) => assignSchedule(ctx, values), P);
}
export async function rescheduleAction(values: Record<string, unknown>) {
  return act((ctx) => rescheduleSchedule(ctx, values), P);
}
export async function startScheduleAction(id: string) {
  return act((ctx) => startSchedule(ctx, id), P);
}
export async function cancelScheduleAction(id: string, reason: string) {
  return act((ctx) => cancelSchedule(ctx, id, reason), P);
}
export async function generateSchedulesAction(date: string) {
  return act((ctx) => generateDailySchedules(ctx, date), P);
}
export async function createCollectionAction(values: Record<string, unknown>) {
  return act((ctx) => createCollection(ctx, values), [...P, "/weighments"]);
}
