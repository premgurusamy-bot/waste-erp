import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, verifySession } from "./session";
import type { Ctx } from "../context";
import { PermissionError } from "../errors";

export type SessionUser = {
  id: string;
  username: string;
  name: string;
  email: string | null;
  roles: string[];
  roleNames: string[];
  permissions: string[];
  mustChangePassword: boolean;
};

export async function loadUserPermissions(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      permissions: { include: { permission: true } },
    },
  });
  if (!user) return null;
  const perms = new Set<string>();
  for (const ur of user.roles) for (const rp of ur.role.permissions) perms.add(rp.permission.code);
  for (const up of user.permissions) perms.add(up.permission.code);
  return { user, permissions: perms };
}

/** The signed-in user for this request (cached per request), or null. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const session = await verifySession(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const loaded = await loadUserPermissions(session.uid);
  if (!loaded) return null;
  const { user, permissions } = loaded;
  if (user.status !== "ACTIVE" || user.sessionVersion !== session.sv) return null;
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    roles: user.roles.map((r) => r.role.code),
    roleNames: user.roles.map((r) => r.role.name),
    permissions: [...permissions],
    mustChangePassword: user.mustChangePassword,
  };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For pages: redirect to the access-denied page if the permission is missing. */
export async function requirePermission(permission: string): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.permissions.includes(permission)) redirect(`/forbidden?p=${encodeURIComponent(permission)}`);
  return user;
}

/** For server actions / route handlers: build the operation context or throw. */
export async function getCtx(): Promise<Ctx> {
  const user = await getCurrentUser();
  if (!user) throw new PermissionError("Your session has expired. Please sign in again.");
  const h = await headers();
  const ip = (h.get("x-forwarded-for") || "").split(",")[0].trim() || h.get("x-real-ip") || null;
  return {
    userId: user.id,
    username: user.username,
    permissions: new Set(user.permissions),
    ip,
    userAgent: h.get("user-agent")?.slice(0, 250) ?? null,
  };
}
