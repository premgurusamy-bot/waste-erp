import { prisma } from "../db.js";
import type { Ctx } from "../context.js";
import { assertCan } from "../context.js";
import { audit } from "../audit.js";
import { badRequest } from "../lib/errors.js";

export const DEFAULT_SETTINGS: Record<string, string> = {
  "backup.auto": "true",
  "backup.autoDatabase": "true",
  "backup.keepDaily": "30",
  "backup.keepMonthly": "12",
  "gst.defaultType": "NONE",
  "gst.defaultRate": "0",
  "gst.sacCode": "996791",
  "invoice.creditDaysDefault": "30",
  "invoice.terms": "Payment due within the credit period. Subject to local jurisdiction.",
  "alerts.expiryDays": "60",
  "target.metric": "PROFIT",
  "gdrive.autoUpload": "true",
};

const EDITABLE = new Set(Object.keys(DEFAULT_SETTINGS));

export async function getSettings(): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function updateSettings(ctx: Ctx, values: Record<string, unknown>) {
  assertCan(ctx, "settings.edit");
  const before = await getSettings();
  const changes: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (!EDITABLE.has(k)) throw badRequest(`Unknown setting ${k}`);
    const s = String(v ?? "").slice(0, 2000);
    if (["backup.keepDaily", "backup.keepMonthly", "alerts.expiryDays"].includes(k) && !(Number(s) >= 1)) throw badRequest(`${k} must be at least 1`);
    changes[k] = s;
  }
  await prisma.$transaction(async (tx) => {
    for (const [key, value] of Object.entries(changes)) await tx.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    await audit(tx, ctx, "EDIT", { type: "SETTINGS" }, Object.fromEntries(Object.keys(changes).map((k) => [k, before[k]])), changes);
  });
  return getSettings();
}
