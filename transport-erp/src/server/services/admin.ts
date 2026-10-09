import { z } from "zod";
import { prisma } from "../db.js";
import { assertCan, type Ctx } from "../context.js";
import { audit } from "../audit.js";
import { badRequest, notFound, conflict } from "../lib/errors.js";
import { parse, optStr, reqStr, gstin, pan, email, mobile } from "../lib/validate.js";
import { plain, pageParams, toDate } from "../lib/util.js";
import { hashPassword, passwordProblem } from "../auth.js";
import { ROLES, todayIst } from "../../shared/calc.js";
import { ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, LOCKED_SUPER_ADMIN, type Permission } from "../../shared/permissions.js";
import { decodeLicenseKey, machineId, currentLicense, clearLicenseCache } from "../license.js";

// ---------------------------------------------------------------- company

const companySchema = z.object({
  name: reqStr(150), legalName: optStr(150), gstin, pan, address: optStr(500), city: optStr(80), state: optStr(80), stateCode: optStr(2), pincode: optStr(10),
  phone: optStr(30), email, bankName: optStr(100), bankAccount: optStr(40), bankIfsc: optStr(20),
  invoicePrefix: z.preprocess((v) => String(v ?? "INV").trim().toUpperCase() || "INV", z.string().regex(/^[A-Z0-9-]{1,10}$/, "use letters/numbers only (max 10)")),
});

export async function getCompany() {
  return plain(await prisma.company.findFirst());
}

export async function saveCompany(ctx: Ctx, body: unknown) {
  assertCan(ctx, "settings.edit");
  const data = parse(companySchema, body);
  return prisma.$transaction(async (tx) => {
    const old = await tx.company.findFirst();
    const c = old ? await tx.company.update({ where: { id: old.id }, data }) : await tx.company.create({ data });
    await audit(tx, ctx, old ? "EDIT" : "CREATE", { type: "COMPANY", id: c.id }, old, c);
    return plain(c);
  });
}

// ---------------------------------------------------------------- users & permissions

const userSchema = z.object({
  username: z.preprocess((v) => String(v ?? "").trim().toLowerCase(), z.string().regex(/^[a-z0-9._-]{3,30}$/, "3-30 letters, numbers, . _ -")),
  name: reqStr(100), mobile, email, role: z.enum(ROLES), active: z.boolean().default(true), password: z.string().optional(),
});

export async function listUsers(ctx: Ctx) {
  assertCan(ctx, "users.manage");
  const users = await prisma.user.findMany({ orderBy: { username: "asc" }, select: { id: true, username: true, name: true, mobile: true, email: true, role: true, active: true, lastLoginAt: true, createdAt: true } });
  return plain(users);
}

export async function saveUser(ctx: Ctx, body: unknown, id?: string) {
  assertCan(ctx, "users.manage");
  const input = parse(userSchema, body);
  if (input.role === "SUPER_ADMIN" && ctx.user.role !== "SUPER_ADMIN") throw badRequest("Only a SUPER ADMIN can create or edit another SUPER ADMIN.");
  const lic = await currentLicense();
  return prisma.$transaction(async (tx) => {
    if (input.active && lic.maxUsers) {
      const active = await tx.user.count({ where: { active: true, ...(id ? { NOT: { id } } : {}) } });
      if (active + 1 > lic.maxUsers) throw badRequest(`Your licence allows ${lic.maxUsers} active users.`);
    }
    const dup = await tx.user.findFirst({ where: { username: input.username, ...(id ? { NOT: { id } } : {}) } });
    if (dup) throw conflict("Username already exists.");
    const { password, ...rest } = input;
    if (id) {
      const old = await tx.user.findUnique({ where: { id } });
      if (!old) throw notFound();
      if (old.role === "SUPER_ADMIN" && ctx.user.role !== "SUPER_ADMIN") throw badRequest("Only a SUPER ADMIN can edit a SUPER ADMIN.");
      if (old.role === "SUPER_ADMIN" && (input.role !== "SUPER_ADMIN" || !input.active)) {
        const others = await tx.user.count({ where: { role: "SUPER_ADMIN", active: true, NOT: { id } } });
        if (!others) throw badRequest("At least one active SUPER ADMIN must remain.");
      }
      const data: any = { ...rest };
      if (password) {
        const p = passwordProblem(password);
        if (p) throw badRequest(p);
        data.passwordHash = await hashPassword(password);
        data.sessionVersion = { increment: 1 };
      }
      if (!input.active || old.role !== input.role) data.sessionVersion = { increment: 1 };
      const u = await tx.user.update({ where: { id }, data });
      await audit(tx, ctx, "EDIT", { type: "USER", id, code: u.username }, old, u);
      return { id: u.id };
    }
    if (!password) throw badRequest("Password is required for a new user.");
    const p = passwordProblem(password);
    if (p) throw badRequest(p);
    const u = await tx.user.create({ data: { ...rest, passwordHash: await hashPassword(password) } });
    await audit(tx, ctx, "CREATE", { type: "USER", id: u.id, code: u.username }, null, u);
    return { id: u.id };
  });
}

export async function changeOwnPassword(ctx: Ctx, current: string, next: string) {
  const { checkPassword } = await import("../auth.js");
  const u = await prisma.user.findUnique({ where: { id: ctx.user.id } });
  if (!u || !(await checkPassword(current ?? "", u.passwordHash))) throw badRequest("Current password is wrong.");
  const p = passwordProblem(next ?? "");
  if (p) throw badRequest(p);
  const updated = await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(next), sessionVersion: { increment: 1 } } });
  await audit(prisma, ctx, "PASSWORD CHANGE", { type: "USER", id: u.id, code: u.username });
  return updated;
}

export async function rolePermissions(ctx: Ctx) {
  assertCan(ctx, "users.manage");
  const overrides = await prisma.rolePermission.findMany();
  const matrix: Record<string, Record<string, boolean>> = {};
  for (const r of ROLES) {
    matrix[r] = {};
    for (const p of ALL_PERMISSIONS) matrix[r][p] = DEFAULT_ROLE_PERMISSIONS[r].includes(p);
  }
  for (const o of overrides) if (matrix[o.role] && o.permission in matrix[o.role]) matrix[o.role][o.permission] = o.allowed;
  for (const p of LOCKED_SUPER_ADMIN) matrix.SUPER_ADMIN[p] = true;
  return { matrix, locked: { SUPER_ADMIN: LOCKED_SUPER_ADMIN } };
}

export async function saveRolePermissions(ctx: Ctx, body: any) {
  assertCan(ctx, "users.manage");
  const matrix = body?.matrix as Record<string, Record<string, boolean>>;
  if (!matrix || typeof matrix !== "object") throw badRequest("Invalid permissions.");
  const before = await rolePermissions(ctx);
  await prisma.$transaction(async (tx) => {
    for (const role of ROLES) {
      for (const p of ALL_PERMISSIONS) {
        if (typeof matrix[role]?.[p] !== "boolean") continue;
        let allowed = matrix[role][p];
        if (role === "SUPER_ADMIN" && LOCKED_SUPER_ADMIN.includes(p as Permission)) allowed = true;
        const def = DEFAULT_ROLE_PERMISSIONS[role].includes(p);
        if (allowed === def) await tx.rolePermission.deleteMany({ where: { role, permission: p } });
        else await tx.rolePermission.upsert({ where: { role_permission: { role, permission: p } }, update: { allowed }, create: { role, permission: p, allowed } });
      }
    }
    await audit(tx, ctx, "EDIT", { type: "ROLE PERMISSIONS" }, before.matrix, matrix);
  });
  return rolePermissions(ctx);
}

// ---------------------------------------------------------------- audit log

export async function listAudit(ctx: Ctx, q: any) {
  assertCan(ctx, "audit.view");
  const { skip, take, page, pageSize } = pageParams(q);
  const where: any = {};
  if (q.action) where.action = q.action;
  if (q.entityType) where.entityType = q.entityType;
  if (q.entityId) where.entityId = q.entityId;
  if (q.user) where.userName = { contains: q.user, mode: "insensitive" };
  if (q.from || q.to) where.at = { ...(q.from ? { gte: toDate(q.from) } : {}), ...(q.to ? { lt: new Date(toDate(q.to)!.getTime() + 86_400_000) } : {}) };
  if (q.q) where.OR = [{ recordCode: { contains: q.q, mode: "insensitive" } }, { userName: { contains: q.q, mode: "insensitive" } }];
  const [rows, total] = await Promise.all([prisma.auditLog.findMany({ where, skip, take, orderBy: { at: "desc" } }), prisma.auditLog.count({ where })]);
  return { rows: plain(rows), total, page, pageSize };
}

// ---------------------------------------------------------------- licence

export async function licenseInfo() {
  const status = await currentLicense();
  const history = await prisma.license.findMany({ orderBy: { installedAt: "desc" }, take: 20, select: { id: true, licenseId: true, company: true, machineId: true, plan: true, startDate: true, expiryDate: true, maxUsers: true, status: true, installedAt: true, installedBy: true } });
  return { status, machineId: machineId(), history: plain(history) };
}

export async function installLicense(ctx: Ctx, key: string) {
  assertCan(ctx, "license.manage");
  const p = decodeLicenseKey(String(key ?? ""));
  if (!p) throw badRequest("This licence key is not valid. Check that it was copied completely.");
  if (p.machineId && p.machineId !== machineId()) throw badRequest(`This key is for computer ${p.machineId}. This computer is ${machineId()}.`);
  if (p.expiryDate && p.expiryDate < todayIst()) throw badRequest(`This key expired on ${p.expiryDate}.`);
  await prisma.$transaction(async (tx) => {
    await tx.license.updateMany({ where: { status: "ACTIVE" }, data: { status: "REPLACED" } });
    const l = await tx.license.create({ data: { licenseId: p.licenseId, licenseKey: key.replace(/\s+/g, ""), company: p.company, machineId: p.machineId, plan: p.plan, startDate: toDate(p.startDate)!, expiryDate: toDate(p.expiryDate), maxUsers: p.maxUsers, installedBy: ctx.user.name } });
    await audit(tx, ctx, "LICENSE CHANGE", { type: "LICENSE", id: l.id, code: p.licenseId }, null, { ...p });
  });
  clearLicenseCache();
  return licenseInfo();
}

// ---------------------------------------------------------------- global search

export async function search(ctx: Ctx, term: string) {
  const q = String(term ?? "").trim();
  if (q.length < 2) return [];
  const ci = { contains: q, mode: "insensitive" as const };
  const plate = { contains: q.replace(/[\s-]/g, ""), mode: "insensitive" as const };
  const out: { type: string; id: string; title: string; subtitle: string; link: string }[] = [];
  if (ctx.permissions.has("trips.view")) {
    const trips = await prisma.trip.findMany({ where: { OR: [{ tripNumber: ci }, { lrNumber: ci }, { ewayBillNumber: ci }] }, take: 8, include: { customer: { select: { name: true } } }, orderBy: { tripDate: "desc" } });
    for (const t of trips) out.push({ type: "Trip", id: t.id, title: `${t.tripNumber}${t.lrNumber ? ` · LR ${t.lrNumber}` : ""}`, subtitle: `${t.customer.name} · ${t.tripDate.toISOString().slice(0, 10)} · ${t.status}`, link: `/trips/${t.id}` });
  }
  if (ctx.permissions.has("billing.view")) {
    const inv = await prisma.customerInvoice.findMany({ where: { invoiceNumber: ci }, take: 5, include: { customer: { select: { name: true } } } });
    for (const i of inv) out.push({ type: "Invoice", id: i.id, title: i.invoiceNumber, subtitle: i.customer.name, link: `/billing/invoices/${i.id}` });
  }
  if (ctx.permissions.has("masters.view")) {
    const [v, c, t, d] = await Promise.all([
      prisma.vehicle.findMany({ where: { OR: [{ vehicleNumber: plate }, { code: ci }] }, take: 5 }),
      prisma.customer.findMany({ where: { OR: [{ name: ci }, { mobile: ci }, { code: ci }, { gstin: ci }] }, take: 5 }),
      prisma.transporter.findMany({ where: { OR: [{ name: ci }, { mobile: ci }, { code: ci }] }, take: 5 }),
      prisma.driver.findMany({ where: { OR: [{ name: ci }, { mobile: ci }, { licenseNumber: ci }] }, take: 5 }),
    ]);
    for (const x of v) out.push({ type: "Vehicle", id: x.id, title: x.vehicleNumber, subtitle: x.vehicleType ?? "", link: `/masters/vehicles/${x.id}` });
    for (const x of c) out.push({ type: "Customer", id: x.id, title: x.name, subtitle: [x.code, x.mobile].filter(Boolean).join(" · "), link: `/masters/customers/${x.id}` });
    for (const x of t) out.push({ type: "Transporter", id: x.id, title: x.name, subtitle: [x.code, x.mobile].filter(Boolean).join(" · "), link: `/masters/transporters/${x.id}` });
    for (const x of d) out.push({ type: "Driver", id: x.id, title: x.name, subtitle: [x.code, x.mobile].filter(Boolean).join(" · "), link: `/masters/drivers/${x.id}` });
  }
  return out;
}
