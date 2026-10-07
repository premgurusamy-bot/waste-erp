import { PermissionError } from "./errors";

/** Who is performing an operation. Every service function receives one. */
export interface Ctx {
  userId: string;
  username: string;
  permissions: Set<string>;
  ip?: string | null;
  userAgent?: string | null;
}

export function can(ctx: Ctx, permission: string): boolean {
  return ctx.permissions.has(permission);
}

export function assertCan(ctx: Ctx, ...permissions: string[]): void {
  for (const p of permissions) {
    if (!ctx.permissions.has(p)) {
      throw new PermissionError(`You do not have permission to perform this action (${p}).`);
    }
  }
}
