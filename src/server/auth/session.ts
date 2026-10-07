import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "erp_session";

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET is missing or too short (minimum 32 characters). Set it in the environment.");
  }
  return new TextEncoder().encode(secret);
}

export function sessionHours() {
  const h = Number(process.env.SESSION_HOURS || 12);
  return Number.isFinite(h) && h > 0 ? h : 12;
}

export type SessionPayload = { uid: string; sv: number };

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ sv: payload.sv })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.uid)
    .setIssuedAt()
    .setExpirationTime(`${sessionHours()}h`)
    .sign(secretKey());
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    return { uid: payload.sub, sv: Number(payload.sv ?? 0) };
  } catch {
    return null;
  }
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: sessionHours() * 3600,
  };
}
