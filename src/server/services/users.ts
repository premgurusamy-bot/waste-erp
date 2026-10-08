import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { changePasswordSchema, passwordRule, userCreateSchema, userUpdateSchema } from "@/lib/validation";
import { audit } from "../audit";
import { assertCan, type Ctx } from "../context";
import { assertUserSeatAvailable } from "../license";
import { AppError } from "../errors";

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 12);
}

/** Verify credentials. Returns the user on success; locks the account after repeated failures. */
export async function authenticate(username: string, password: string, meta: { ip?: string | null; userAgent?: string | null }) {
  const uname = (username || "").trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { username: uname } });
  const generic = "Invalid username or password.";
  if (!user) {
    await bcrypt.compare(password || "", "$2a$12$CwTycUXWue0Thq9StjUM0uJ8.WbHnN2QXm0W0rNCuD9XwQvGRFTiu"); // timing
    await prisma.auditLog.create({ data: { action: "LOGIN_FAILED", module: "auth", username: uname, recordLabel: "Unknown user", ipAddress: meta.ip, userAgent: meta.userAgent } });
    throw new AppError(generic);
  }
  if (user.status !== "ACTIVE") throw new AppError("This account is disabled. Contact the administrator.");
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    throw new AppError(`Too many failed attempts. Try again in ${mins} minute(s).`);
  }
  const ok = await bcrypt.compare(password || "", user.passwordHash);
  if (!ok) {
    const failed = user.failedLogins + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60000) : null },
    });
    await prisma.auditLog.create({ data: { userId: user.id, username: user.username, action: "LOGIN_FAILED", module: "auth", recordId: user.id, ipAddress: meta.ip, userAgent: meta.userAgent } });
    throw new AppError(failed >= MAX_FAILED ? `Too many failed attempts. Account locked for ${LOCK_MINUTES} minutes.` : generic);
  }
  const u = await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await prisma.auditLog.create({ data: { userId: user.id, username: user.username, action: "LOGIN", module: "auth", recordId: user.id, ipAddress: meta.ip, userAgent: meta.userAgent } });
  return u;
}

async function permissionIds(codes: string[]) {
  const valid = codes.filter((c) => ALL_PERMISSIONS.includes(c));
  const perms = await prisma.permission.findMany({ where: { code: { in: valid } } });
  return perms.map((p) => p.id);
}

export async function createUser(ctx: Ctx, input: unknown) {
  assertCan(ctx, "users.manage");
  const i = userCreateSchema.parse(input);
  const passwordHash = await hashPassword(i.password);
  const permIds = await permissionIds(i.permissionCodes);
  return prisma.$transaction(async (tx) => {
    const exists = await tx.user.findUnique({ where: { username: i.username } });
    if (exists) throw new AppError("This username is already taken.", { username: "Already taken" });
    await assertUserSeatAvailable(tx);
    const u = await tx.user.create({
      data: {
        username: i.username,
        name: i.name,
        email: i.email ?? null,
        mobile: i.mobile ?? null,
        passwordHash,
        mustChangePassword: true,
        roles: { create: i.roleIds.map((roleId) => ({ roleId })) },
        permissions: { create: permIds.map((permissionId) => ({ permissionId })) },
      },
    });
    await audit(tx, ctx, { action: "CREATE", module: "users", recordId: u.id, recordLabel: u.username, newValues: { username: u.username, name: u.name, roleIds: i.roleIds, permissions: i.permissionCodes } });
    return u;
  });
}

export async function updateUser(ctx: Ctx, input: unknown) {
  assertCan(ctx, "users.manage");
  const i = userUpdateSchema.parse(input);
  const permIds = await permissionIds(i.permissionCodes);
  return prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id: i.id }, include: { roles: true, permissions: { include: { permission: true } } } });
    if (!before) throw new AppError("User not found.");
    if (before.id === ctx.userId && i.status === "DISABLED") throw new AppError("You cannot disable your own account.");
    if (before.status !== "ACTIVE" && i.status === "ACTIVE") await assertUserSeatAvailable(tx, before.id);
    const adminRole = await tx.role.findUnique({ where: { code: "ADMIN" } });
    if (adminRole && before.roles.some((r) => r.roleId === adminRole.id) && (!i.roleIds.includes(adminRole.id) || i.status === "DISABLED")) {
      const otherAdmins = await tx.user.count({ where: { id: { not: before.id }, status: "ACTIVE", roles: { some: { roleId: adminRole.id } } } });
      if (otherAdmins === 0) throw new AppError("At least one active administrator must remain.");
    }
    await tx.userRole.deleteMany({ where: { userId: i.id } });
    await tx.userPermission.deleteMany({ where: { userId: i.id } });
    const securityChanged =
      before.status !== i.status ||
      JSON.stringify(before.roles.map((r) => r.roleId).sort()) !== JSON.stringify([...i.roleIds].sort());
    const u = await tx.user.update({
      where: { id: i.id },
      data: {
        name: i.name,
        email: i.email ?? null,
        mobile: i.mobile ?? null,
        status: i.status,
        sessionVersion: i.status === "DISABLED" ? { increment: 1 } : undefined,
        roles: { create: i.roleIds.map((roleId) => ({ roleId })) },
        permissions: { create: permIds.map((permissionId) => ({ permissionId })) },
      },
    });
    await audit(tx, ctx, {
      action: before.status !== i.status ? (i.status === "DISABLED" ? "DEACTIVATE" : "ACTIVATE") : "UPDATE",
      module: "users",
      recordId: u.id,
      recordLabel: u.username,
      oldValues: { name: before.name, status: before.status, roleIds: before.roles.map((r) => r.roleId), permissions: before.permissions.map((p) => p.permission.code) },
      newValues: { name: u.name, status: u.status, roleIds: i.roleIds, permissions: i.permissionCodes, securityChanged },
    });
    return u;
  });
}

/** Admin password reset: sets a temporary password, forces change at next login, signs out sessions. */
export async function resetPassword(ctx: Ctx, userId: string, newPassword: string) {
  assertCan(ctx, "users.manage");
  passwordRule.parse(newPassword);
  const passwordHash = await hashPassword(newPassword);
  return prisma.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: true, failedLogins: 0, lockedUntil: null, sessionVersion: { increment: 1 } },
    });
    await audit(tx, ctx, { action: "PASSWORD_RESET", module: "users", recordId: u.id, recordLabel: u.username });
    return u;
  });
}

export async function changeOwnPassword(ctx: Ctx, input: unknown) {
  const i = changePasswordSchema.parse(input);
  const user = await prisma.user.findUnique({ where: { id: ctx.userId } });
  if (!user) throw new AppError("User not found.");
  if (!(await bcrypt.compare(i.currentPassword, user.passwordHash))) throw new AppError("Current password is incorrect.", { currentPassword: "Incorrect" });
  if (i.currentPassword === i.newPassword) throw new AppError("The new password must be different.", { newPassword: "Same as current" });
  const passwordHash = await hashPassword(i.newPassword);
  return prisma.$transaction(async (tx) => {
    const u = await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false, sessionVersion: { increment: 1 } } });
    await audit(tx, ctx, { action: "PASSWORD_CHANGE", module: "users", recordId: u.id, recordLabel: u.username });
    return u;
  });
}

export async function updateRolePermissions(ctx: Ctx, roleId: string, codes: string[]) {
  assertCan(ctx, "users.manage");
  return prisma.$transaction(async (tx) => {
    const role = await tx.role.findUnique({ where: { id: roleId }, include: { permissions: { include: { permission: true } } } });
    if (!role) throw new AppError("Role not found.");
    if (role.code === "ADMIN") throw new AppError("The Administrator role always has full access and cannot be edited.");
    const ids = (await tx.permission.findMany({ where: { code: { in: codes.filter((c) => ALL_PERMISSIONS.includes(c)) } } })).map((p) => p.id);
    await tx.rolePermission.deleteMany({ where: { roleId } });
    await tx.rolePermission.createMany({ data: ids.map((permissionId) => ({ roleId, permissionId })) });
    await audit(tx, ctx, {
      action: "UPDATE",
      module: "users",
      recordId: roleId,
      recordLabel: `Role ${role.name} permissions`,
      oldValues: { permissions: role.permissions.map((p) => p.permission.code) },
      newValues: { permissions: codes },
    });
  });
}
