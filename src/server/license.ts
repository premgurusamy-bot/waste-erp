import { prisma } from "@/lib/db";
import { todayISO } from "@/lib/utils";
import { audit } from "./audit";
import { assertCan, type Ctx } from "./context";
import { AppError } from "./errors";
import { decodeLicenseKey, evaluateLicense, type LicenseStatus } from "./license-key";

const KEY_SETTING = "license.key";

export async function getLicenseStatus(): Promise<LicenseStatus> {
  const [key, company, last] = await Promise.all([
    prisma.setting.findUnique({ where: { key: KEY_SETTING } }),
    prisma.company.findFirst({ select: { gstin: true, createdAt: true } }),
    prisma.auditLog.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  return evaluateLicense({
    key: key?.value || null,
    companyGstin: company?.gstin ?? null,
    installedOn: todayISO(company?.createdAt ?? new Date()),
    today: todayISO(),
    lastActivity: last?.createdAt ?? null,
  });
}

/** Block changes once the licence has lapsed. Viewing, printing and exporting stay available. */
export async function assertLicenseWritable() {
  const s = await getLicenseStatus();
  if (!s.writable) throw new AppError(s.message);
}

/** Refuse to add or re-activate a user beyond the number the licence allows. */
export async function assertUserSeatAvailable(tx: Pick<typeof prisma, "user">, excludeUserId?: string) {
  const s = await getLicenseStatus();
  if (!s.users) return;
  const active = await tx.user.count({ where: { status: "ACTIVE", id: excludeUserId ? { not: excludeUserId } : undefined } });
  if (active >= s.users) throw new AppError(`Your licence allows ${s.users} active users. Disable an unused user or contact your vendor to add more.`);
}

export async function installLicense(ctx: Ctx, raw: string) {
  assertCan(ctx, "settings.manage");
  const key = String(raw ?? "").replace(/\s+/g, "");
  const p = decodeLicenseKey(key);
  if (!p) throw new AppError("This licence key is not valid. Copy the whole key exactly as you received it, starting with GCERP-.");
  const company = await prisma.company.findFirst();
  if (p.gstin && p.gstin.toUpperCase() !== (company?.gstin ?? "").toUpperCase()) {
    throw new AppError(`This licence is for GSTIN ${p.gstin}. Your company profile has ${company?.gstin || "no GSTIN"}. Correct the company profile first, or ask your vendor for the right key.`);
  }
  if (p.expires < todayISO()) throw new AppError(`This licence key already expired on ${p.expires}. Ask your vendor for a renewed key.`);
  return prisma.$transaction(async (tx) => {
    const before = await tx.setting.findUnique({ where: { key: KEY_SETTING } });
    const old = before ? decodeLicenseKey(before.value) : null;
    await tx.setting.upsert({ where: { key: KEY_SETTING }, update: { value: key }, create: { key: KEY_SETTING, value: key, description: "Licence key" } });
    await audit(tx, ctx, {
      action: "UPDATE",
      module: "settings",
      recordId: KEY_SETTING,
      recordLabel: "Licence key",
      oldValues: old ? { id: old.id, licensee: old.licensee, expires: old.expires } : null,
      newValues: { id: p.id, licensee: p.licensee, gstin: p.gstin, users: p.users, expires: p.expires },
    });
    return { licensee: p.licensee, expires: p.expires };
  });
}
