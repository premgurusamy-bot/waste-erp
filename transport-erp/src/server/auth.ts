import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "./db.js";
import { config } from "./config.js";
import { ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, LOCKED_SUPER_ADMIN, type Permission } from "../shared/permissions.js";
import type { Role } from "../shared/calc.js";
import type { Ctx } from "./context.js";
import { AppError } from "./lib/errors.js";

export const COOKIE = "grl_session";
const SESSION_HOURS = 12;
const key = () => new TextEncoder().encode(config.authSecret || "test-secret-test-secret-test-secret!!");

export const hashPassword = (p: string) => bcrypt.hash(p, 12);
export const checkPassword = (p: string, h: string) => bcrypt.compare(p, h);

export function passwordProblem(p: string): string | null {
  if (p.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return "Password must contain letters and numbers.";
  return null;
}

export async function signSession(user: { id: string; sessionVersion: number }) {
  return new SignJWT({ v: user.sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(key());
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: config.cookieSecure, maxAge: SESSION_HOURS * 3600_000, path: "/" });
}

export async function permissionsFor(role: string): Promise<Set<Permission>> {
  const base = new Set<Permission>(DEFAULT_ROLE_PERMISSIONS[role as Role] ?? []);
  const overrides = await prisma.rolePermission.findMany({ where: { role } });
  for (const o of overrides) {
    if (!ALL_PERMISSIONS.includes(o.permission as Permission)) continue;
    if (o.allowed) base.add(o.permission as Permission);
    else base.delete(o.permission as Permission);
  }
  if (role === "SUPER_ADMIN") LOCKED_SUPER_ADMIN.forEach((p) => base.add(p));
  return base;
}

export async function login(username: string, password: string) {
  const user = await prisma.user.findUnique({ where: { username: username.trim().toLowerCase() } });
  const fail = new AppError(401, "Wrong username or password.");
  if (!user || !user.active) {
    await bcrypt.compare(password, "$2a$12$abcdefghijklmnopqrstuuIu1z3a4w8nMqzQhJk8M8yFqQ6pZr1Fe"); // equal timing
    throw fail;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(423, "Too many wrong passwords. The account is locked for 15 minutes.");
  }
  if (!(await checkPassword(password, user.passwordHash))) {
    const failed = user.failedLogins + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: failed >= 5 ? 0 : failed, lockedUntil: failed >= 5 ? new Date(Date.now() + 15 * 60_000) : null },
    });
    throw fail;
  }
  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  return user;
}

/** Attaches req.ctx when a valid session cookie is present. */
export async function sessionMiddleware(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[COOKIE];
    if (token) {
      const { payload } = await jwtVerify(token, key());
      const user = payload.sub ? await prisma.user.findUnique({ where: { id: payload.sub } }) : null;
      if (user && user.active && user.sessionVersion === payload.v) {
        const ctx: Ctx = {
          user: { id: user.id, username: user.username, name: user.name, role: user.role },
          permissions: await permissionsFor(user.role),
          ip: req.ip,
          device: req.get("user-agent") ?? undefined,
        };
        (req as any).ctx = ctx;
      }
    }
  } catch {
    /* invalid or expired token: treated as signed out */
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!(req as any).ctx) return next(new AppError(401, "Please sign in."));
  next();
}

export function requirePerm(p: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const ctx = (req as any).ctx as Ctx | undefined;
    if (!ctx) return next(new AppError(401, "Please sign in."));
    if (!ctx.permissions.has(p)) return next(new AppError(403, "You do not have permission to do this."));
    next();
  };
}
