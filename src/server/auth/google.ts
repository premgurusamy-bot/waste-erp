import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { audit } from "../audit";
import { assertCan, type Ctx } from "../context";
import { AppError } from "../errors";

/**
 * "Sign in with Google" (OpenID Connect, authorization-code flow with PKCE).
 * A Google account only gets in if its verified email matches an active user's email,
 * so the administrator decides who may use Google sign-in; nobody can sign themselves up.
 */

const KEYS = { publicUrl: "access.publicUrl", clientId: "access.googleClientId", clientSecret: "access.googleClientSecret" } as const;
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
export const CALLBACK_PATH = "/api/auth/google/callback";

// ---------- settings (client secret is stored encrypted with a key derived from AUTH_SECRET) ----------

function boxKey() {
  return createHash("sha256").update(`${process.env.AUTH_SECRET ?? ""}:settings-box`).digest();
}
export function sealSecret(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", boxKey(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64url")}`;
}
export function openSecret(sealed: string): string | null {
  try {
    const raw = Buffer.from(sealed.replace(/^v1:/, ""), "base64url");
    const d = createDecipheriv("aes-256-gcm", boxKey(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export type AccessConfig = { publicUrl: string | null; clientId: string | null; clientSecret: string | null };

export async function getAccessConfig(): Promise<AccessConfig> {
  const rows = await prisma.setting.findMany({ where: { key: { in: Object.values(KEYS) } } });
  const v = (k: string) => rows.find((r) => r.key === k)?.value || null;
  const sealed = v(KEYS.clientSecret);
  return { publicUrl: v(KEYS.publicUrl), clientId: v(KEYS.clientId), clientSecret: sealed ? openSecret(sealed) : null };
}

export async function googleEnabled() {
  const c = await getAccessConfig().catch(() => null);
  return Boolean(c?.publicUrl && c.clientId && c.clientSecret);
}

export const accessSchema = z.object({
  publicUrl: z
    .string()
    .trim()
    .transform((s) => s.replace(/\/+$/, ""))
    .refine((s) => s === "" || /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(s), "Enter the full web address starting with https://, e.g. https://erp.yourcompany.in"),
  clientId: z
    .string()
    .trim()
    .refine((s) => s === "" || s.endsWith(".apps.googleusercontent.com"), "The Client ID ends with .apps.googleusercontent.com"),
  clientSecret: z.string().trim().optional(),
});

export async function saveAccessConfig(ctx: Ctx, input: unknown) {
  assertCan(ctx, "settings.manage");
  const i = accessSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const put = (key: string, value: string) => tx.setting.upsert({ where: { key }, update: { value }, create: { key, value, description: "Remote access / Google sign-in" } });
    await put(KEYS.publicUrl, i.publicUrl);
    await put(KEYS.clientId, i.clientId);
    if (i.clientSecret) await put(KEYS.clientSecret, sealSecret(i.clientSecret)); // blank = keep the saved one
    if (!i.clientId) await put(KEYS.clientSecret, "");
    await audit(tx, ctx, {
      action: "UPDATE",
      module: "settings",
      recordId: "access",
      recordLabel: "Remote access & Google sign-in",
      newValues: { publicUrl: i.publicUrl, clientId: i.clientId, clientSecret: i.clientSecret ? "(changed)" : "(unchanged)" },
    });
    return { publicUrl: i.publicUrl };
  });
}

// ---------- the sign-in flow ----------

function stateKey() {
  return new TextEncoder().encode(`${process.env.AUTH_SECRET ?? ""}:google-state`);
}
const b64url = (b: Buffer) => b.toString("base64url");

export type FlowState = { state: string; nonce: string; verifier: string; next: string; app: boolean };

/** Builds Google's sign-in URL and the signed cookie that remembers this attempt. */
export async function startGoogleSignIn(cfg: AccessConfig, opts: { next: string; app: boolean }) {
  if (!cfg.publicUrl || !cfg.clientId) throw new AppError("Google sign-in is not set up.");
  const flow: FlowState = { state: b64url(randomBytes(16)), nonce: b64url(randomBytes(16)), verifier: b64url(randomBytes(32)), next: safeNext(opts.next), app: opts.app };
  const challenge = b64url(createHash("sha256").update(flow.verifier).digest());
  const url = new URL(GOOGLE_AUTH);
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.publicUrl + CALLBACK_PATH,
    response_type: "code",
    scope: "openid email profile",
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  const cookie = await new SignJWT({ ...flow }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("10m").sign(stateKey());
  return { url: url.toString(), cookie };
}

export async function readFlowCookie(token: string | undefined): Promise<FlowState | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, stateKey(), { algorithms: ["HS256"] });
    return payload as unknown as FlowState;
  } catch {
    return null;
  }
}

export function safeNext(next: string | null | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

/** Exchanges the code for tokens and returns the verified Google email. */
export async function finishGoogleSignIn(cfg: AccessConfig, flow: FlowState, code: string) {
  const res = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId!,
      client_secret: cfg.clientSecret!,
      redirect_uri: cfg.publicUrl + CALLBACK_PATH,
      grant_type: "authorization_code",
      code_verifier: flow.verifier,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; error_description?: string };
  if (!res.ok || !body.id_token) throw new AppError(`Google did not accept the sign-in${body.error_description ? `: ${body.error_description}` : ""}.`);
  const { payload } = await jwtVerify(body.id_token, GOOGLE_JWKS, { issuer: ["https://accounts.google.com", "accounts.google.com"], audience: cfg.clientId! });
  if (payload.nonce !== flow.nonce) throw new AppError("Sign-in could not be verified. Please try again.");
  if (payload.email_verified !== true || typeof payload.email !== "string") throw new AppError("Your Google account email is not verified.");
  return payload.email.toLowerCase();
}

/** The active user whose email is this Google account. */
export async function userForGoogleEmail(email: string, meta: { ip?: string | null; userAgent?: string | null }) {
  const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  if (!user) {
    await prisma.auditLog.create({ data: { action: "LOGIN_FAILED", module: "auth", username: email, recordLabel: "Google account not linked to a user", ipAddress: meta.ip, userAgent: meta.userAgent } });
    throw new AppError(`${email} is not registered in GreenCycle. Ask your administrator to add this Gmail address to your user account.`);
  }
  if (user.status !== "ACTIVE") throw new AppError("This account is disabled. Contact the administrator.");
  const u = await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await prisma.auditLog.create({ data: { userId: u.id, username: u.username, action: "LOGIN", module: "auth", recordId: u.id, recordLabel: "Signed in with Google", ipAddress: meta.ip, userAgent: meta.userAgent } });
  return u;
}

// ---------- hand-over to the Android app (Google does not allow sign-in inside an app's web view) ----------

const usedCodes = new Map<string, number>();

export async function issueAppCode(uid: string, sv: number) {
  return new SignJWT({ sv }).setProtectedHeader({ alg: "HS256" }).setSubject(uid).setJti(b64url(randomBytes(12))).setExpirationTime("2m").sign(stateKey());
}

/** One-time: a code can be exchanged for a session only once, within two minutes. */
export async function redeemAppCode(code: string) {
  try {
    const { payload } = await jwtVerify(code, stateKey(), { algorithms: ["HS256"] });
    if (!payload.sub || !payload.jti || usedCodes.has(payload.jti)) return null;
    const now = Date.now();
    for (const [k, exp] of usedCodes) if (exp < now) usedCodes.delete(k);
    usedCodes.set(payload.jti, now + 5 * 60_000);
    return { uid: payload.sub, sv: Number(payload.sv ?? 0) };
  } catch {
    return null;
  }
}
