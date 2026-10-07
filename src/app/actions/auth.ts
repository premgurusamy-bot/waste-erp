"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCtx } from "@/server/auth/current-user";
import { cookieOptions, SESSION_COOKIE, signSession } from "@/server/auth/session";
import { act } from "@/server/action";
import { AppError } from "@/server/errors";
import { authenticate, changeOwnPassword } from "@/server/services/users";
import { markNotificationsRead } from "@/server/services/notifications";

export async function login(_prev: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  const h = await headers();
  const meta = { ip: (h.get("x-forwarded-for") || "").split(",")[0].trim() || null, userAgent: h.get("user-agent")?.slice(0, 250) ?? null };
  let next = String(form.get("next") || "/dashboard");
  if (!next.startsWith("/") || next.startsWith("//")) next = "/dashboard";
  try {
    const user = await authenticate(String(form.get("username") || ""), String(form.get("password") || ""), meta);
    const token = await signSession({ uid: user.id, sv: user.sessionVersion });
    (await cookies()).set(SESSION_COOKIE, token, cookieOptions());
    if (user.mustChangePassword) next = "/profile?force=1";
  } catch (e) {
    return { error: e instanceof AppError ? e.message : "Unable to sign in right now. Please try again." };
  }
  redirect(next);
}

export async function logout() {
  try {
    const ctx = await getCtx();
    await prisma.auditLog.create({ data: { userId: ctx.userId, username: ctx.username, action: "LOGOUT", module: "auth", ipAddress: ctx.ip, userAgent: ctx.userAgent } });
  } catch {
    // session already gone
  }
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

export async function changePasswordAction(values: Record<string, unknown>) {
  return act(async (ctx) => {
    const u = await changeOwnPassword(ctx, values);
    // Password change signs out every other session; re-issue this one.
    (await cookies()).set(SESSION_COOKIE, await signSession({ uid: u.id, sv: u.sessionVersion }), cookieOptions());
    return { id: u.id };
  });
}

export async function markReadAction(ids: string[]) {
  return act(async (ctx) => markNotificationsRead(ctx.userId, ids.slice(0, 100)));
}
