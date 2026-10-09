import type { Request } from "express";
import type { Permission } from "../shared/permissions.js";
import { forbidden } from "./lib/errors.js";

export type Ctx = {
  user: { id: string; username: string; name: string; role: string };
  permissions: Set<Permission>;
  ip?: string;
  device?: string;
};

export function can(ctx: Ctx, p: Permission) {
  return ctx.permissions.has(p);
}

export function assertCan(ctx: Ctx, p: Permission) {
  if (!ctx.permissions.has(p)) throw forbidden();
}

export function ctxOf(req: Request): Ctx {
  const c = (req as any).ctx as Ctx | undefined;
  if (!c) throw forbidden("Please sign in.");
  return c;
}

/** Context used by seeding, scheduled jobs and tests. */
export function systemCtx(perms: Permission[], name = "SYSTEM"): Ctx {
  return { user: { id: "system", username: "system", name, role: "SUPER_ADMIN" }, permissions: new Set(perms) };
}
