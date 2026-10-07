"use server";

import { act } from "@/server/action";
import { createEntity, setEntityActive, updateEntity, type EntityKey } from "@/server/services/masters";

const PATHS: Partial<Record<EntityKey, string[]>> = {
  customer: ["/customers"],
  customerContact: ["/customers"],
  site: ["/sites", "/customers"],
  vehicle: ["/vehicles"],
  driver: ["/drivers"],
  buyer: ["/buyers"],
  supplier: ["/suppliers"],
};

export async function saveEntityAction(key: EntityKey, id: string | null, values: Record<string, unknown>) {
  return act((ctx) => (id ? updateEntity(ctx, key, id, values) : createEntity(ctx, key, values)), PATHS[key] ?? ["/masters"]);
}

export async function setActiveAction(key: EntityKey, id: string, active: boolean) {
  return act((ctx) => setEntityActive(ctx, key, id, active), PATHS[key] ?? ["/masters"]);
}
