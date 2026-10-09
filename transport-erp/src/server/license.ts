import { createPublicKey, verify, createHash, type KeyObject } from "node:crypto";
import os from "node:os";
import { prisma } from "./db.js";
import { addDays, daysBetween, todayIst } from "../shared/calc.js";

/**
 * Licence keys are signed by the vendor with an Ed25519 PRIVATE key that never ships with the app
 * (see scripts/license-issue.ts and LICENSING.md). The app only contains the PUBLIC key below,
 * so it can verify a key but can never create one.
 *
 * Key format:  GRL1.<base64url(JSON payload)>.<base64url(Ed25519 signature of the payload part)>
 */
export const VENDOR_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA8DTNjTVUKQROW2820WCK5v+hgmtmNy3T1gfeLmSANBM=
-----END PUBLIC KEY-----`;

export const PLANS = ["TRIAL", "MONTHLY", "YEARLY", "PERPETUAL"] as const;
export type Plan = (typeof PLANS)[number];
export const TRIAL_DAYS = 30;

export type LicensePayload = {
  v: 1;
  licenseId: string;
  company: string;
  machineId: string | null; // null = any computer
  plan: Plan;
  startDate: string;
  expiryDate: string | null; // null = perpetual
  maxUsers: number | null;
};

let publicKey: KeyObject | null = null;
function vendorKey(): KeyObject {
  publicKey ??= createPublicKey(VENDOR_PUBLIC_KEY_PEM);
  return publicKey;
}

export function decodeLicenseKey(raw: string, key: KeyObject = vendorKey()): LicensePayload | null {
  const k = raw.replace(/\s+/g, "");
  const parts = k.split(".");
  if (parts.length !== 3 || parts[0] !== "GRL1") return null;
  const [, body, sig] = parts;
  try {
    if (!verify(null, Buffer.from(body), key, Buffer.from(sig, "base64url"))) return null;
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (p?.v !== 1 || !PLANS.includes(p.plan) || typeof p.company !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.startDate)) return null;
    if (p.expiryDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(p.expiryDate)) return null;
    return p as LicensePayload;
  } catch {
    return null;
  }
}

/** Stable identifier of this computer: hash of host name, platform, CPU model and hardware (MAC) addresses. */
export function machineId(): string {
  const macs = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && !i.internal && i.mac && i.mac !== "00:00:00:00:00:00")
    .map((i) => i!.mac)
    .sort();
  const raw = [os.hostname(), os.platform(), os.arch(), os.cpus()[0]?.model ?? "", macs[0] ?? ""].join("|");
  const h = createHash("sha256").update(raw).digest("hex").toUpperCase();
  return `GRL-${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}`;
}

export type LicenseLevel = "OK" | "WARNING" | "URGENT" | "EXPIRED" | "INVALID";
export type LicenseStatus = {
  plan: Plan;
  company: string | null;
  licenseId: string | null;
  machineId: string;
  startDate: string;
  expiryDate: string | null;
  maxUsers: number | null;
  daysLeft: number | null;
  level: LicenseLevel;
  writable: boolean;
  message: string;
};

/**
 * Pure licence evaluation (testable).
 *  > 30 days left: OK; 30..16: WARNING (30-day warning); 15..8: WARNING (15-day warning); 7..0: URGENT; < 0: EXPIRED.
 * Expired never deletes or hides data: the ERP becomes read-only, but backup, export,
 * licence renewal and contacting the administrator stay available.
 */
export function evaluateLicense(input: { payload: LicensePayload | null; trialStart: string; today: string; machineId: string }): LicenseStatus {
  const { payload, today } = input;
  const base = { machineId: input.machineId };
  let plan: Plan, startDate: string, expiryDate: string | null, company: string | null = null, licenseId: string | null = null, maxUsers: number | null = null;
  if (!payload) {
    plan = "TRIAL"; startDate = input.trialStart; expiryDate = addDays(input.trialStart, TRIAL_DAYS - 1);
  } else {
    if (payload.machineId && payload.machineId !== input.machineId) {
      return { ...base, plan: payload.plan, company: payload.company, licenseId: payload.licenseId, startDate: payload.startDate, expiryDate: payload.expiryDate, maxUsers: payload.maxUsers, daysLeft: null, level: "INVALID", writable: false, message: `This licence is for another computer (${payload.machineId}). This computer is ${input.machineId}. Data is read-only; backup and export still work. Contact your administrator for a licence for this computer.` };
    }
    ({ plan, startDate, expiryDate, company, licenseId, maxUsers } = payload);
  }
  if (expiryDate === null) {
    return { ...base, plan, company, licenseId, startDate, expiryDate, maxUsers, daysLeft: null, level: "OK", writable: true, message: "Perpetual licence." };
  }
  const daysLeft = daysBetween(today, expiryDate);
  let level: LicenseLevel = "OK";
  let message = `${plan} licence valid until ${expiryDate} (${daysLeft} days left).`;
  if (daysLeft < 0) {
    level = "EXPIRED";
    message = "LICENSE EXPIRED. Your data is safe and read-only. You can still take backups, export data and renew the licence. Contact your administrator to renew.";
  } else if (daysLeft <= 7) {
    level = "URGENT"; message = `URGENT: licence expires in ${daysLeft} day(s) on ${expiryDate}. Renew now.`;
  } else if (daysLeft <= 15) {
    level = "WARNING"; message = `Licence expires in ${daysLeft} days on ${expiryDate}.`;
  } else if (daysLeft <= 30) {
    level = "WARNING"; message = `Licence expires in ${daysLeft} days on ${expiryDate}.`;
  }
  return { ...base, plan, company, licenseId, startDate, expiryDate, maxUsers, daysLeft, level, writable: level !== "EXPIRED", message };
}

export async function trialStart(): Promise<string> {
  const s = await prisma.setting.findUnique({ where: { key: "license.trialStart" } });
  if (s) return s.value;
  const today = todayIst();
  await prisma.setting.upsert({ where: { key: "license.trialStart" }, update: {}, create: { key: "license.trialStart", value: today } });
  return today;
}

let cache: { at: number; status: LicenseStatus } | null = null;
export function clearLicenseCache() { cache = null; }

export async function currentLicense(): Promise<LicenseStatus> {
  if (cache && Date.now() - cache.at < 60_000) return cache.status;
  const lic = await prisma.license.findFirst({ where: { status: "ACTIVE" }, orderBy: { installedAt: "desc" } });
  const payload = lic ? decodeLicenseKey(lic.licenseKey) : null;
  const status = evaluateLicense({ payload, trialStart: await trialStart(), today: todayIst(), machineId: machineId() });
  cache = { at: Date.now(), status };
  return status;
}
