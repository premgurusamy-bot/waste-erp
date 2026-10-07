import { prisma } from "@/lib/db";
import { STATES } from "@/lib/utils";
import { companySchema, gstSettingsSchema, ledgerAccountSchema, sequenceSchema } from "@/lib/validation";
import { audit, diff } from "../audit";
import { assertCan, type Ctx } from "../context";
import { AppError } from "../errors";

export async function updateCompany(ctx: Ctx, input: unknown) {
  assertCan(ctx, "settings.manage");
  const i = companySchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const before = await tx.company.findFirst();
    if (!before) throw new AppError("Company profile missing.");
    const data = Object.fromEntries(Object.entries(i).map(([k, v]) => [k, v ?? null])) as any;
    data.stateName = STATES[i.stateCode] ?? before.stateName;
    const c = await tx.company.update({ where: { id: before.id }, data });
    const ch = diff(before, c);
    await audit(tx, ctx, { action: "UPDATE", module: "settings", recordId: c.id, recordLabel: "Company profile", oldValues: ch.before, newValues: ch.after });
    return c;
  });
}

export async function updateGstSettings(ctx: Ctx, input: unknown) {
  assertCan(ctx, "gst.manage");
  const i = gstSettingsSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const company = await tx.company.findFirstOrThrow();
    const before = await tx.gstSetting.findUnique({ where: { companyId: company.id } });
    const data = {
      gstEnabled: i.gstEnabled,
      defaultServiceSac: i.defaultServiceSac,
      defaultServiceRateId: i.defaultServiceRateId ?? null,
      defaultGoodsRateId: i.defaultGoodsRateId ?? null,
      roundOffInvoices: i.roundOffInvoices,
    };
    const s = await tx.gstSetting.upsert({ where: { companyId: company.id }, update: data, create: { companyId: company.id, ...data } });
    await audit(tx, ctx, { action: "UPDATE", module: "gst", recordId: s.id, recordLabel: "GST settings", oldValues: before, newValues: s });
    return s;
  });
}

export async function updateSequence(ctx: Ctx, input: unknown) {
  assertCan(ctx, "settings.manage");
  const i = sequenceSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const before = await tx.numberSequence.findUnique({ where: { key: i.key } });
    if (!before) throw new AppError("Sequence not found.");
    const s = await tx.numberSequence.update({ where: { key: i.key }, data: { prefix: i.prefix, includeYear: i.includeYear, padding: i.padding } });
    // keep yearly counters in step with the prefix/padding
    await tx.numberSequence.updateMany({ where: { key: { startsWith: `${i.key}@` } }, data: { prefix: i.prefix, padding: i.padding } });
    await audit(tx, ctx, {
      action: "UPDATE",
      module: "settings",
      recordId: i.key,
      recordLabel: `Numbering ${before.name}`,
      oldValues: { prefix: before.prefix, includeYear: before.includeYear, padding: before.padding },
      newValues: { prefix: s.prefix, includeYear: s.includeYear, padding: s.padding },
    });
    return s;
  });
}

export async function saveLedgerAccount(ctx: Ctx, id: string | null, input: unknown) {
  assertCan(ctx, "accounts.manage");
  const i = ledgerAccountSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    if (id) {
      const before = await tx.ledgerAccount.findUniqueOrThrow({ where: { id } });
      if (before.isSystem && (before.code !== i.code || before.type !== i.type || before.subType !== (i.subType ?? null))) {
        throw new AppError("Code, type and sub-type of system accounts cannot be changed.");
      }
      const a = await tx.ledgerAccount.update({ where: { id }, data: { ...i, subType: i.subType ?? null } });
      const ch = diff(before, a);
      await audit(tx, ctx, { action: "UPDATE", module: "accounts", recordId: id, recordLabel: `${a.code} ${a.name}`, oldValues: ch.before, newValues: ch.after });
      return a;
    }
    const a = await tx.ledgerAccount.create({ data: { ...i, subType: i.subType ?? null } });
    await audit(tx, ctx, { action: "CREATE", module: "accounts", recordId: a.id, recordLabel: `${a.code} ${a.name}`, newValues: a });
    return a;
  });
}

export async function getSetting(key: string, fallback: string) {
  const s = await prisma.setting.findUnique({ where: { key } });
  return s?.value ?? fallback;
}

export async function setSetting(ctx: Ctx, key: string, value: string) {
  assertCan(ctx, "settings.manage");
  return prisma.$transaction(async (tx) => {
    const before = await tx.setting.findUnique({ where: { key } });
    const s = await tx.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    await audit(tx, ctx, { action: "UPDATE", module: "settings", recordId: key, recordLabel: `Setting ${key}`, oldValues: { value: before?.value }, newValues: { value } });
    return s;
  });
}
