import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeLicenseKey, evaluateLicense } from "@/server/license-key";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const make = (p: Record<string, unknown>) => {
  const body = Buffer.from(JSON.stringify({ v: 1, id: "t", licensee: "ABC Recyclers", issued: "2026-01-01", ...p })).toString("base64url");
  return `GCERP-${body}.${sign(null, Buffer.from(body), privateKey).toString("base64url")}`;
};
const run = (key: string | null, today: string, extra: Partial<Parameters<typeof evaluateLicense>[0]> = {}) =>
  evaluateLicense({ key, companyGstin: "33AABCG1234K1Z5", installedOn: "2026-10-01", today, now: new Date(`${today}T06:00:00Z`), publicKey, ...extra });

describe("Licence keys", () => {
  it("accepts a vendor-signed key and rejects a tampered one", () => {
    const key = make({ expires: "2027-10-31" });
    expect(decodeLicenseKey(key, publicKey)?.licensee).toBe("ABC Recyclers");
    const [body, sig] = key.slice(6).split(".");
    const forged = Buffer.from(Buffer.from(body, "base64url").toString().replace("2027", "2099")).toString("base64url");
    expect(decodeLicenseKey(`GCERP-${forged}.${sig}`, publicKey)).toBeNull();
    expect(decodeLicenseKey("hello", publicKey)).toBeNull();
  });

  it("gives a 30-day trial without a key, then view-only", () => {
    expect(run(null, "2026-10-20")).toMatchObject({ state: "trial", writable: true, daysLeft: 11 });
    expect(run(null, "2026-11-05")).toMatchObject({ state: "expired", writable: false });
  });

  it("warns before expiry, allows a 15-day grace period, then becomes view-only", () => {
    const key = make({ expires: "2027-10-31" });
    expect(run(key, "2027-01-01")).toMatchObject({ state: "active", writable: true });
    expect(run(key, "2027-10-20")).toMatchObject({ state: "expiring", writable: true, daysLeft: 11 });
    expect(run(key, "2027-11-10")).toMatchObject({ state: "grace", writable: true });
    expect(run(key, "2027-11-20")).toMatchObject({ state: "expired", writable: false });
  });

  it("is locked to the customer's GSTIN", () => {
    const key = make({ expires: "2027-10-31", gstin: "33AABCG1234K1Z5" });
    expect(run(key, "2027-01-01").writable).toBe(true);
    expect(run(key, "2027-01-01", { companyGstin: "29XYZAB1234C1Z9" })).toMatchObject({ state: "mismatch", writable: false });
  });

  it("detects a computer clock turned back", () => {
    const key = make({ expires: "2027-10-31" });
    expect(run(key, "2027-01-01", { lastActivity: new Date("2027-12-15T10:00:00Z") })).toMatchObject({ state: "clock", writable: false });
  });
});
