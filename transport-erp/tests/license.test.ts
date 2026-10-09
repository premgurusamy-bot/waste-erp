import { describe, it, expect } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { decodeLicenseKey, evaluateLicense, type LicensePayload } from "../src/server/license.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const make = (p: Partial<LicensePayload>) => {
  const payload = { v: 1, licenseId: "LIC-1", company: "G Road Lines", machineId: null, plan: "YEARLY", startDate: "2026-01-01", expiryDate: "2026-12-31", maxUsers: 5, ...p };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `GRL1.${body}.${sign(null, Buffer.from(body), privateKey).toString("base64url")}`;
};

describe("licence keys (Ed25519 signed)", () => {
  it("accepts a key signed with the private key and rejects tampering or the wrong key", () => {
    const key = make({});
    expect(decodeLicenseKey(key, publicKey)?.company).toBe("G Road Lines");
    const [a, b, c] = key.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(b, "base64url").toString()), expiryDate: "2099-12-31" })).toString("base64url");
    expect(decodeLicenseKey(`${a}.${forged}.${c}`, publicKey)).toBeNull();
    expect(decodeLicenseKey(key)).toBeNull(); // shipped vendor key did not sign it
    expect(decodeLicenseKey("garbage", publicKey)).toBeNull();
  });
  it("warns at 30 / 15 / 7 days, expires to read-only, never deletes data", () => {
    const payload = decodeLicenseKey(make({}), publicKey)!;
    const ev = (today: string) => evaluateLicense({ payload, trialStart: "2026-01-01", today, machineId: "M1" });
    expect(ev("2026-11-01")).toMatchObject({ level: "OK", writable: true });
    expect(ev("2026-12-01")).toMatchObject({ level: "WARNING", daysLeft: 30 });
    expect(ev("2026-12-16")).toMatchObject({ level: "WARNING", daysLeft: 15 });
    expect(ev("2026-12-24")).toMatchObject({ level: "URGENT", daysLeft: 7 });
    const expired = ev("2027-01-01");
    expect(expired).toMatchObject({ level: "EXPIRED", writable: false });
    expect(expired.message).toContain("LICENSE EXPIRED");
    expect(expired.message).toMatch(/backup/i);
  });
  it("trial lasts 30 days; perpetual never expires; machine-locked keys need the right computer", () => {
    expect(evaluateLicense({ payload: null, trialStart: "2026-10-01", today: "2026-10-30", machineId: "M" })).toMatchObject({ plan: "TRIAL", writable: true, daysLeft: 0 });
    expect(evaluateLicense({ payload: null, trialStart: "2026-10-01", today: "2026-10-31", machineId: "M" })).toMatchObject({ level: "EXPIRED" });
    const perp = decodeLicenseKey(make({ plan: "PERPETUAL", expiryDate: null }), publicKey)!;
    expect(evaluateLicense({ payload: perp, trialStart: "2026-01-01", today: "2040-01-01", machineId: "M" })).toMatchObject({ level: "OK", writable: true });
    const locked = decodeLicenseKey(make({ machineId: "GRL-AAAA" }), publicKey)!;
    expect(evaluateLicense({ payload: locked, trialStart: "2026-01-01", today: "2026-06-01", machineId: "GRL-BBBB" })).toMatchObject({ level: "INVALID", writable: false });
  });
});
