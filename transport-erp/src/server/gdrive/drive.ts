/**
 * Google Drive storage for backups (the user's own Gmail / Google account).
 *
 * - OAuth 2.0 "installed app" flow with scope drive.file: the ERP can only see and change the files it created
 *   itself, never anything else in the user's Drive.
 * - Client secret and refresh token are stored encrypted (AES-256-GCM, key derived from AUTH_SECRET) in
 *   local.* settings, which are never written into Excel backups.
 * - Files go to "My Drive / G Road Lines ERP Backup / {Excel, Database, Documents, Exports}".
 */
import fs from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { config } from "../config.js";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
export const ROOT_FOLDER = "G Road Lines ERP Backup";
export const SUB_FOLDERS = ["Excel", "Database", "Documents", "Exports"] as const;
export type SubFolder = (typeof SUB_FOLDERS)[number];
const FOLDER_MIME = "application/vnd.google-apps.folder";

const K = {
  clientId: "local.gdrive.clientId",
  clientSecret: "local.gdrive.clientSecret",
  refreshToken: "local.gdrive.refreshToken",
  email: "local.gdrive.email",
  folders: "local.gdrive.folders",
  connectedAt: "local.gdrive.connectedAt",
};

// ---------------------------------------------------------------- encrypted settings
const key = () => createHash("sha256").update(`${config.authSecret || "grl-dev-secret"}|gdrive`).digest();
export function encrypt(text: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}
export function decrypt(blob: string) {
  const [v, iv, tag, data] = blob.split(":");
  if (v !== "v1") throw new Error("Unknown secret format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

async function getSetting(k: string) {
  return (await prisma.setting.findUnique({ where: { key: k } }))?.value ?? null;
}
async function setSetting(k: string, value: string) {
  await prisma.setting.upsert({ where: { key: k }, update: { value }, create: { key: k, value } });
}

export async function saveClient(clientId: string, clientSecret: string) {
  if (!/\.apps\.googleusercontent\.com$/.test(clientId.trim())) throw new Error("The Client ID must end with .apps.googleusercontent.com");
  if (clientSecret.trim().length < 10) throw new Error("Enter the Client secret.");
  await setSetting(K.clientId, clientId.trim());
  await setSetting(K.clientSecret, encrypt(clientSecret.trim()));
}

async function client() {
  const id = await getSetting(K.clientId);
  const secret = await getSetting(K.clientSecret);
  if (!id || !secret) throw new Error("Google Drive is not set up. Enter the OAuth Client ID and secret first.");
  return { id, secret: decrypt(secret) };
}

export async function driveStatus() {
  const [id, token, email, connectedAt] = await Promise.all([getSetting(K.clientId), getSetting(K.refreshToken), getSetting(K.email), getSetting(K.connectedAt)]);
  const folders = JSON.parse((await getSetting(K.folders)) ?? "{}");
  return { configured: !!id, connected: !!token, email, connectedAt, clientId: id, rootFolderId: folders.root ?? null, folderUrl: folders.root ? `https://drive.google.com/drive/folders/${folders.root}` : null };
}

export async function isConnected() {
  return !!(await getSetting(K.refreshToken));
}

// ---------------------------------------------------------------- OAuth
const pendingStates = new Map<string, { at: number; redirectUri: string }>();

export async function authUrl(redirectUri: string) {
  const c = await client();
  const state = randomBytes(16).toString("hex");
  pendingStates.set(state, { at: Date.now(), redirectUri });
  for (const [s, v] of pendingStates) if (Date.now() - v.at > 15 * 60_000) pendingStates.delete(s);
  const q = new URLSearchParams({ client_id: c.id, redirect_uri: redirectUri, response_type: "code", scope: DRIVE_SCOPE, access_type: "offline", prompt: "consent", state, include_granted_scopes: "true" });
  return `${AUTH_URL}?${q.toString()}`;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google sign-in failed: ${j.error_description || j.error || res.status}`);
  return j;
}

export async function handleCallback(code: string, state: string) {
  const st = pendingStates.get(state);
  if (!st) throw new Error("The Google sign-in link expired. Click Connect Google Drive again.");
  pendingStates.delete(state);
  const c = await client();
  const t = await tokenRequest({ code, client_id: c.id, client_secret: c.secret, redirect_uri: st.redirectUri, grant_type: "authorization_code" });
  if (!t.refresh_token) throw new Error("Google did not return a refresh token. Remove the app's access at myaccount.google.com/permissions and connect again.");
  await setSetting(K.refreshToken, encrypt(t.refresh_token));
  accessCache = { token: t.access_token, until: Date.now() + (Number(t.expires_in ?? 3600) - 120) * 1000 };
  const about = await api("GET", `${API}/about?fields=user(emailAddress,displayName)`);
  await setSetting(K.email, about.user?.emailAddress ?? "");
  await setSetting(K.connectedAt, new Date().toISOString());
  await setSetting(K.folders, "{}");
  await ensureFolders();
  return driveStatus();
}

export async function disconnect() {
  const token = await getSetting(K.refreshToken);
  if (token) {
    try { await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decrypt(token))}`, { method: "POST" }); } catch { /* offline: just forget it */ }
  }
  await prisma.setting.deleteMany({ where: { key: { in: [K.refreshToken, K.email, K.folders, K.connectedAt] } } });
  accessCache = null;
}

let accessCache: { token: string; until: number } | null = null;
export function resetAccessCache() { accessCache = null; }
async function accessToken() {
  if (accessCache && Date.now() < accessCache.until) return accessCache.token;
  const rt = await getSetting(K.refreshToken);
  if (!rt) throw new Error("Google Drive is not connected.");
  const c = await client();
  const t = await tokenRequest({ refresh_token: decrypt(rt), client_id: c.id, client_secret: c.secret, grant_type: "refresh_token" });
  accessCache = { token: t.access_token, until: Date.now() + (Number(t.expires_in ?? 3600) - 120) * 1000 };
  return accessCache.token;
}

async function api(method: string, url: string, body?: any, extraHeaders: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, { method, headers: { Authorization: `Bearer ${await accessToken()}`, ...(body ? { "Content-Type": "application/json" } : {}), ...extraHeaders }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    const j: any = await res.json().catch(() => ({}));
    throw new Error(`Google Drive error ${res.status}: ${j.error?.message ?? res.statusText}`);
  }
  return res.status === 204 ? {} : res.json();
}

const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function findOrCreateFolder(name: string, parent?: string) {
  const query = `name = '${q(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false${parent ? ` and '${q(parent)}' in parents` : ""}`;
  const r = await api("GET", `${API}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&spaces=drive`);
  if (r.files?.length) return r.files[0].id as string;
  const f = await api("POST", `${API}/files?fields=id`, { name, mimeType: FOLDER_MIME, ...(parent ? { parents: [parent] } : {}) });
  return f.id as string;
}

/** Folder ids, created on first use and remembered. */
export async function ensureFolders(): Promise<Record<"root" | SubFolder, string>> {
  const saved = JSON.parse((await getSetting(K.folders)) ?? "{}");
  if (saved.root && SUB_FOLDERS.every((s) => saved[s])) return saved;
  const root = await findOrCreateFolder(ROOT_FOLDER);
  const out: any = { root };
  for (const s of SUB_FOLDERS) out[s] = await findOrCreateFolder(s, root);
  await setSetting(K.folders, JSON.stringify(out));
  return out;
}

export type DriveFile = { id: string; name: string; size?: string; createdTime?: string; webViewLink?: string; appProperties?: Record<string, string> };

/** Resumable upload (works for large files). `convertTo` makes Google convert it, e.g. CSV -> Google Sheet. */
export async function uploadFile(filePath: string, opts: { folder: SubFolder; name?: string; mimeType?: string; convertTo?: string; appProperties?: Record<string, string> }): Promise<DriveFile> {
  const folders = await ensureFolders();
  const name = opts.name ?? path.basename(filePath);
  const size = fs.statSync(filePath).size;
  const mime = opts.mimeType ?? mimeOf(name);
  const meta: any = { name, parents: [folders[opts.folder]], appProperties: { grl: "1", ...(opts.appProperties ?? {}) } };
  if (opts.convertTo) meta.mimeType = opts.convertTo;
  const init = await fetch(`${UPLOAD}?uploadType=resumable&fields=id,name,size,createdTime,webViewLink,appProperties`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": mime, "X-Upload-Content-Length": String(size) },
    body: JSON.stringify(meta),
  });
  if (!init.ok) throw new Error(`Google Drive upload could not start (${init.status}): ${(await init.text()).slice(0, 300)}`);
  const location = init.headers.get("location");
  if (!location) throw new Error("Google Drive upload could not start (no upload address).");
  const put = await fetch(location, { method: "PUT", headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": mime, "Content-Length": String(size) }, body: fs.readFileSync(filePath) });
  if (!put.ok) throw new Error(`Google Drive upload failed (${put.status}): ${(await put.text()).slice(0, 300)}`);
  return put.json() as Promise<DriveFile>;
}

export async function listFolder(folder: SubFolder, pageLimit = 5): Promise<DriveFile[]> {
  const folders = await ensureFolders();
  const out: DriveFile[] = [];
  let pageToken = "";
  for (let i = 0; i < pageLimit; i++) {
    const query = encodeURIComponent(`'${q(folders[folder])}' in parents and trashed = false`);
    const r = await api("GET", `${API}/files?q=${query}&orderBy=createdTime desc&pageSize=1000&fields=nextPageToken,files(id,name,size,createdTime,webViewLink,appProperties)${pageToken ? `&pageToken=${pageToken}` : ""}`);
    out.push(...(r.files ?? []));
    if (!r.nextPageToken) break;
    pageToken = encodeURIComponent(r.nextPageToken);
  }
  return out;
}

/** Download a file the ERP created to a local path. */
export async function downloadFile(fileId: string, dest: string) {
  const meta = await api("GET", `${API}/files/${encodeURIComponent(fileId)}?fields=id,name,appProperties,size`);
  if (meta.appProperties?.grl !== "1") throw new Error("That file was not created by the ERP.");
  const res = await fetch(`${API}/files/${encodeURIComponent(fileId)}?alt=media`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (!res.ok) throw new Error(`Google Drive download failed (${res.status}).`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return { name: meta.name as string, path: dest };
}

export function mimeOf(name: string) {
  const ext = path.extname(name).toLowerCase();
  return ({
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".zip": "application/zip", ".gz": "application/gzip", ".dump": "application/octet-stream",
    ".json": "application/json", ".csv": "text/csv", ".pdf": "application/pdf", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".heic": "image/heic", ".xml": "application/xml", ".tsv": "text/tab-separated-values",
  } as Record<string, string>)[ext] ?? "application/octet-stream";
}
