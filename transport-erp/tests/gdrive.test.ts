/** Google Drive backup, tested against a fake Google API (no real account is needed for the test). */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import { prisma } from "../src/server/db.js";
import { seedBase, seedDemo } from "../src/server/seed/seed.js";
import * as drive from "../src/server/gdrive/drive.js";
import { syncAll, driveBackups, downloadForRestore } from "../src/server/gdrive/sync.js";
import { createExcelBackup } from "../src/server/backup/service.js";
import { readBackupWorkbook } from "../src/server/backup/excel-read.js";
import { verifyParsed } from "../src/server/backup/restore.js";
import { adminCtx, wipeAll } from "./helpers.js";

type F = { id: string; name: string; parents: string[]; mimeType?: string; appProperties?: any; data?: Buffer; createdTime: string };
const files: F[] = [];
let n = 0, tokenCalls = 0, failUploads = false;
const json = (o: any, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...headers } });

async function fakeGoogle(input: any, init: any = {}): Promise<Response> {
  const url = new URL(String(input));
  const method = init.method ?? "GET";
  if (url.host === "oauth2.googleapis.com" && url.pathname === "/token") {
    tokenCalls++;
    const body = new URLSearchParams(String(init.body));
    if (body.get("grant_type") === "authorization_code" && body.get("code") !== "good-code") return json({ error: "invalid_grant" }, 400);
    return json({ access_token: `at-${tokenCalls}`, refresh_token: "rt-secret", expires_in: 3600 });
  }
  if (url.host === "oauth2.googleapis.com") return json({});
  expect(String(init.headers?.Authorization ?? "")).toMatch(/^Bearer at-/);
  if (url.pathname === "/drive/v3/about") return json({ user: { emailAddress: "premgurusamy@gmail.com" } });
  if (url.pathname === "/drive/v3/files" && method === "GET") {
    const q = url.searchParams.get("q")!;
    const name = q.match(/name = '([^']+)'/)?.[1];
    const parent = q.match(/'([^']+)' in parents/)?.[1];
    const list = files.filter((f) => (!name || f.name === name) && (!parent || f.parents.includes(parent)));
    return json({ files: list.map((f) => ({ id: f.id, name: f.name, size: String(f.data?.length ?? 0), createdTime: f.createdTime, appProperties: f.appProperties })) });
  }
  if (url.pathname === "/drive/v3/files" && method === "POST") {
    const meta = JSON.parse(init.body);
    const f = { id: `id${++n}`, name: meta.name, parents: meta.parents ?? [], mimeType: meta.mimeType, createdTime: new Date().toISOString() };
    files.push(f);
    return json({ id: f.id });
  }
  if (url.pathname === "/upload/drive/v3/files" && method === "POST") {
    expect(url.searchParams.get("uploadType")).toBe("resumable");
    const meta = JSON.parse(init.body);
    return new Response(null, { status: 200, headers: { location: `https://www.googleapis.com/upload/session/${encodeURIComponent(JSON.stringify(meta))}` } });
  }
  if (url.pathname.startsWith("/upload/session/") && method === "PUT") {
    if (failUploads) return new Response("quota", { status: 503 });
    const meta = JSON.parse(decodeURIComponent(url.pathname.slice("/upload/session/".length)));
    const f: F = { id: `id${++n}`, name: meta.name, parents: meta.parents, appProperties: meta.appProperties, mimeType: meta.mimeType, data: Buffer.from(init.body), createdTime: new Date().toISOString() };
    files.push(f);
    return json({ id: f.id, name: f.name, size: String(f.data!.length), webViewLink: `https://drive.google.com/file/d/${f.id}/view`, appProperties: f.appProperties });
  }
  const m = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
  if (m) {
    const f = files.find((x) => x.id === decodeURIComponent(m[1]));
    if (!f) return json({ error: { message: "not found" } }, 404);
    if (url.searchParams.get("alt") === "media") return new Response(f.data);
    return json({ id: f.id, name: f.name, appProperties: f.appProperties });
  }
  throw new Error(`unexpected ${method} ${url}`);
}

describe("Google Drive backup", () => {
  beforeAll(async () => {
    await wipeAll();
    await seedBase({ adminPassword: "Admin@12345" });
    await seedDemo(adminCtx());
    vi.stubGlobal("fetch", vi.fn(fakeGoogle));
    drive.resetAccessCache();
  });
  afterAll(() => vi.unstubAllGlobals());

  it("stores the client secret and refresh token encrypted, never in plain text", async () => {
    await expect(drive.saveClient("bad", "x")).rejects.toThrow(/apps.googleusercontent.com/);
    await drive.saveClient("123-abc.apps.googleusercontent.com", "GOCSPX-supersecret");
    const stored = await prisma.setting.findUnique({ where: { key: "local.gdrive.clientSecret" } });
    expect(stored!.value).not.toContain("supersecret");
    expect(drive.decrypt(stored!.value)).toBe("GOCSPX-supersecret");
  });

  it("connects with OAuth (drive.file scope only) and creates the backup folders", async () => {
    const url = new URL(await drive.authUrl("http://localhost:4000/api/gdrive/callback"));
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/drive.file");
    expect(url.searchParams.get("access_type")).toBe("offline");
    const state = url.searchParams.get("state")!;
    await expect(drive.handleCallback("good-code", "forged-state")).rejects.toThrow(/expired/);
    const st = await drive.handleCallback("good-code", state);
    expect(st).toMatchObject({ connected: true, email: "premgurusamy@gmail.com" });
    expect(files.map((f) => f.name)).toEqual(["G Road Lines ERP Backup", "Excel", "Database", "Documents", "Exports"]);
    expect((await prisma.setting.findUnique({ where: { key: "local.gdrive.refreshToken" } }))!.value).not.toContain("rt-secret");
  });

  it("copies every new backup (Excel + database) to Drive and retries failures", async () => {
    failUploads = true;
    const b = await createExcelBackup("MANUAL", "Tester", { withDatabase: true, waitForDrive: true });
    expect(b.drive).toBe("PENDING");
    const first = await syncAll();
    expect(first).toMatchObject({ connected: true, failed: 1 });
    expect((await prisma.backupRecord.findUnique({ where: { id: b.id } }))!.driveStatus).toBe("FAILED");
    failUploads = false;
    const second = await syncAll();
    expect(second).toMatchObject({ uploaded: 1, failed: 0 });
    const rec = await prisma.backupRecord.findUnique({ where: { id: b.id } });
    expect(rec).toMatchObject({ driveStatus: "UPLOADED" });
    expect(rec!.driveDbFileId).toBeTruthy();
    const inDrive = files.find((f) => f.id === rec!.driveFileId)!;
    expect(inDrive.data!.equals(fs.readFileSync(b.filePath))).toBe(true);
    expect(inDrive.appProperties).toMatchObject({ grl: "1", checksum: b.checksum });
    expect((await driveBackups()).excel.map((f) => f.name)).toContain(b.fileName);
  });

  it("restores from a backup downloaded from Drive (the file is byte-identical and verifies)", async () => {
    const f = (await driveBackups()).excel[0];
    const d = await downloadForRestore(f.id);
    const v = verifyParsed(await readBackupWorkbook(d.tmpPath));
    expect(v.checksumOk).toBe(true);
  });

  it("only downloads files the ERP itself created", async () => {
    files.push({ id: "foreign", name: "holiday.jpg", parents: [], createdTime: "", data: Buffer.from("x") });
    await expect(drive.downloadFile("foreign", "/tmp/x")).rejects.toThrow(/not created by the ERP/);
  });

  it("disconnect forgets the token", async () => {
    await drive.disconnect();
    expect(await drive.isConnected()).toBe(false);
    expect((await syncAll()).connected).toBe(false);
  });
});
