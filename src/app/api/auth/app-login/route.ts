import { NextResponse } from "next/server";
import { redeemAppCode } from "@/server/auth/google";
import { cookieOptions, SESSION_COOKIE, signSession } from "@/server/auth/session";

/** The Android app opens this with the one-time code it received after Google sign-in. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const s = await redeemAppCode(url.searchParams.get("code") ?? "");
  if (!s) return NextResponse.redirect(new URL("/login?error=" + encodeURIComponent("The sign-in link expired. Please tap Sign in with Google again."), req.url));
  const r = NextResponse.redirect(new URL("/dashboard", req.url));
  r.cookies.set(SESSION_COOKIE, await signSession(s), cookieOptions());
  return r;
}
