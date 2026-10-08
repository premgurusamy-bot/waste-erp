import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/server/app.js";
import { prisma } from "../src/server/db.js";
import { seedBase } from "../src/server/seed/seed.js";
import { hashPassword } from "../src/server/auth.js";
import { clearLicenseCache } from "../src/server/license.js";
import { wipeAll } from "./helpers.js";

const app = createApp();
const H = { "X-Requested-With": "GRL" };

async function loginAs(username: string, password: string) {
  const agent = request.agent(app);
  const r = await agent.post("/api/auth/login").set(H).send({ username, password });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return agent;
}

describe("HTTP API security", () => {
  beforeAll(async () => {
    await wipeAll();
    await seedBase({ adminPassword: "Admin@12345" });
    await prisma.user.create({ data: { username: "viewer", name: "View Only", role: "VIEWER", passwordHash: await hashPassword("Viewer@123") } });
  });

  it("requires login, hashes passwords and sets an httpOnly cookie", async () => {
    expect((await request(app).get("/api/dashboard")).status).toBe(401);
    const bad = await request(app).post("/api/auth/login").set(H).send({ username: "admin", password: "wrong" });
    expect(bad.status).toBe(401);
    const ok = await request(app).post("/api/auth/login").set(H).send({ username: "admin", password: "Admin@12345" });
    expect(ok.status).toBe(200);
    expect(String(ok.headers["set-cookie"])).toMatch(/HttpOnly/i);
    const u = await prisma.user.findUnique({ where: { username: "admin" } });
    expect(u?.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(await prisma.auditLog.count({ where: { action: "LOGIN" } })).toBeGreaterThan(0);
  });

  it("blocks cross-site / header-less state changes (CSRF)", async () => {
    const a = await loginAs("admin", "Admin@12345");
    expect((await a.post("/api/masters/customers").send({ name: "X" })).status).toBe(403);
    expect((await a.post("/api/masters/customers").set(H).set("Origin", "http://evil.example").send({ name: "X" })).status).toBe(403);
    const r = await a.post("/api/masters/customers").set(H).send({ name: "<script>alert(1)</script>' OR 1=1 --" });
    expect(r.status).toBe(200);
    expect(r.body.name).toBe("<script>alert(1)</script>' OR 1=1 --"); // stored as plain text, rendered escaped by React
  });

  it("validates input", async () => {
    const a = await loginAs("admin", "Admin@12345");
    const r = await a.post("/api/trips").set(H).send({ tripDate: "08-10-2026", customerId: "nope" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/tripDate|customerId/);
  });

  it("enforces role permissions", async () => {
    const v = await loginAs("viewer", "Viewer@123");
    expect((await v.get("/api/trips")).status).toBe(200);
    expect((await v.post("/api/masters/customers").set(H).send({ name: "Nope" })).status).toBe(403);
    expect((await v.post("/api/backup/now").set(H).send({})).status).toBe(403);
    expect((await v.get("/api/users")).status).toBe(403);
  });

  it("locks the account after repeated wrong passwords", async () => {
    for (let i = 0; i < 5; i++) await request(app).post("/api/auth/login").set(H).send({ username: "viewer", password: "bad" });
    const r = await request(app).post("/api/auth/login").set(H).send({ username: "viewer", password: "Viewer@123" });
    expect(r.status).toBe(423);
    await prisma.user.update({ where: { username: "viewer" }, data: { lockedUntil: null, failedLogins: 0 } });
  });

  it("when the licence has EXPIRED: data is read-only but backup and export still work", async () => {
    await prisma.setting.upsert({ where: { key: "license.trialStart" }, update: { value: "2020-01-01" }, create: { key: "license.trialStart", value: "2020-01-01" } });
    clearLicenseCache();
    const a = await loginAs("admin", "Admin@12345");
    const me = await a.get("/api/auth/me");
    expect(me.body.license.level).toBe("EXPIRED");
    expect((await a.get("/api/masters/customers")).status).toBe(200); // data still visible
    const blocked = await a.post("/api/masters/customers").set(H).send({ name: "New" });
    expect(blocked.status).toBe(402);
    expect(blocked.body.error).toContain("LICENSE EXPIRED");
    const b = await a.post("/api/backup/now").set(H).send({ withDatabase: false });
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    expect(b.body.verified).toBe(true);
    expect((await a.get("/api/reports/expiry?format=xlsx")).status).toBe(200);
    expect(await prisma.customer.count()).toBeGreaterThan(0); // nothing deleted
    await prisma.setting.delete({ where: { key: "license.trialStart" } });
    clearLicenseCache();
  });

  it("rejects a forged licence key", async () => {
    const a = await loginAs("admin", "Admin@12345");
    const r = await a.post("/api/license").set(H).send({ key: "GRL1.eyJ2IjoxfQ.AAAA" });
    expect(r.status).toBe(400);
  });

  it("only accepts real image/PDF uploads", async () => {
    const a = await loginAs("admin", "Admin@12345");
    const bad = await a.post("/api/documents").set(H).field("docType", "POD").attach("file", Buffer.from("<html>not an image</html>"), "pod.jpg");
    expect(bad.status).toBe(400);
    const png = Buffer.from("89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA63F8FFFF3F0005FE02FEA7D6A4E40000000049454E44AE426082", "hex");
    const ok = await a.post("/api/documents").set(H).field("docType", "POD").attach("file", png, "pod.png");
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.sha256).toMatch(/^[0-9a-f]{64}$/);
    const f = await a.get(`/api/documents/${ok.body.id}/file`);
    expect(f.status).toBe(200);
    expect(f.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("sends security headers", async () => {
    const r = await request(app).get("/api/health");
    expect(r.headers["content-security-policy"]).toBeTruthy();
    expect(r.headers["x-frame-options"]).toBeTruthy();
    expect(r.headers["x-powered-by"]).toBeUndefined();
  });
});
