import { createPublicKey, verify } from "node:crypto";

/**
 * Licence keys are signed by the vendor with an Ed25519 private key that never ships with the app.
 * The app holds only the public key, so it can check a key but cannot create one.
 * Format: GCERP-<base64url(JSON payload)>.<base64url(signature over the payload part)>
 */
const PUBLIC_KEY = createPublicKey(`-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEALAc/Vs26FRxptForHzM2PQOIK4sOBQpHtqk+2pJCkkA=
-----END PUBLIC KEY-----`);

export const KEY_PREFIX = "GCERP-";
export const TRIAL_DAYS = 30;
export const WARN_DAYS = 30;
export const GRACE_DAYS = 15;

export type LicensePayload = {
  v: 1;
  id: string;
  licensee: string;
  gstin?: string;
  users?: number;
  issued: string;
  expires: string;
};

/** Parse and verify a licence key. Returns null when the key is malformed or not signed by the vendor. */
export function decodeLicenseKey(raw: string, publicKey = PUBLIC_KEY): LicensePayload | null {
  const key = raw.replace(/\s+/g, "");
  if (!key.startsWith(KEY_PREFIX)) return null;
  const [body, sig] = key.slice(KEY_PREFIX.length).split(".");
  if (!body || !sig) return null;
  try {
    if (!verify(null, Buffer.from(body), publicKey, Buffer.from(sig, "base64url"))) return null;
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (p?.v !== 1 || typeof p.licensee !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.expires)) return null;
    return p as LicensePayload;
  } catch {
    return null;
  }
}

export type LicenseState = "trial" | "active" | "expiring" | "grace" | "expired" | "invalid" | "mismatch" | "clock";

export type LicenseStatus = {
  state: LicenseState;
  writable: boolean;
  licensee: string | null;
  gstin: string | null;
  users: number | null;
  expires: string | null;
  daysLeft: number;
  message: string;
};

const DAY = 86_400_000;
const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/**
 * Decide what the installation may do. Pure so it can be tested without a database.
 * `today` is the calendar date in the app timezone; `lastActivity` is the newest audit timestamp,
 * used to notice a computer clock that was turned back to stretch a licence.
 */
export function evaluateLicense(input: {
  key: string | null;
  companyGstin: string | null;
  installedOn: string;
  today: string;
  now?: Date;
  lastActivity?: Date | null;
  publicKey?: ReturnType<typeof createPublicKey>;
}): LicenseStatus {
  const now = input.now ?? new Date();
  const base = { licensee: null, gstin: null, users: null, expires: null, daysLeft: 0 };
  const renew = "Contact your software vendor to renew.";

  if (input.lastActivity && input.lastActivity.getTime() > now.getTime() + DAY) {
    return { ...base, state: "clock", writable: false, message: `The computer date looks wrong: records exist from ${input.lastActivity.toISOString().slice(0, 10)}, after today. Correct the system date and time. The system is in view-only mode until then.` };
  }

  if (!input.key) {
    const expires = addDays(input.installedOn, TRIAL_DAYS);
    const daysLeft = Math.round((Date.parse(expires) - Date.parse(input.today)) / DAY);
    if (daysLeft >= 0) return { ...base, state: "trial", writable: true, expires, daysLeft, message: `Trial licence: ${daysLeft} day(s) left. Install your licence key under Settings → Licence.` };
    return { ...base, state: "expired", writable: false, expires, daysLeft, message: `The trial ended on ${fmt(expires)}. The system is in view-only mode: you can still see, print and export all your data. Install a licence key under Settings → Licence.` };
  }

  const p = decodeLicenseKey(input.key, input.publicKey);
  if (!p) return { ...base, state: "invalid", writable: false, message: `The installed licence key is not valid. The system is in view-only mode. ${renew}` };

  const info = { licensee: p.licensee, gstin: p.gstin ?? null, users: p.users ?? null, expires: p.expires };
  if (p.gstin && norm(p.gstin) !== norm(input.companyGstin)) {
    return { ...info, daysLeft: 0, state: "mismatch", writable: false, message: `This licence is issued for GSTIN ${p.gstin}, but the company profile has ${input.companyGstin || "no GSTIN"}. The system is in view-only mode. ${renew}` };
  }

  const daysLeft = Math.round((Date.parse(p.expires) - Date.parse(input.today)) / DAY);
  if (daysLeft > WARN_DAYS) return { ...info, daysLeft, state: "active", writable: true, message: `Licensed to ${p.licensee} until ${fmt(p.expires)}.` };
  if (daysLeft >= 0) return { ...info, daysLeft, state: "expiring", writable: true, message: `Your licence expires on ${fmt(p.expires)} (${daysLeft} day(s) left). ${renew}` };
  if (daysLeft >= -GRACE_DAYS) {
    const last = addDays(p.expires, GRACE_DAYS);
    return { ...info, daysLeft, state: "grace", writable: true, message: `Your licence expired on ${fmt(p.expires)}. Everything keeps working until ${fmt(last)}; after that the system becomes view-only. ${renew}` };
  }
  return { ...info, daysLeft, state: "expired", writable: false, message: `Your licence expired on ${fmt(p.expires)}. The system is in view-only mode: you can still see, print and export all your data. ${renew}` };
}

const norm = (g: string | null | undefined) => (g ?? "").trim().toUpperCase();
