import { NextResponse } from "next/server";
import { getAccessConfig, startGoogleSignIn } from "@/server/auth/google";

const FLOW_COOKIE = "g_signin";

/** Sends the browser to Google. Always runs on the public address so the callback finds its cookie. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const cfg = await getAccessConfig();
  if (!cfg.publicUrl || !cfg.clientId || !cfg.clientSecret) return NextResponse.redirect(new URL("/login?error=" + encodeURIComponent("Google sign-in is not set up yet."), req.url));
  const here = `${req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "")}://${req.headers.get("x-forwarded-host") ?? req.headers.get("host")}`;
  if (new URL(cfg.publicUrl).host !== new URL(here).host) return NextResponse.redirect(cfg.publicUrl + url.pathname + url.search);

  const { url: google, cookie } = await startGoogleSignIn(cfg, { next: url.searchParams.get("next") ?? "/dashboard", app: url.searchParams.get("app") === "1" });
  const res = NextResponse.redirect(google);
  res.cookies.set(FLOW_COOKIE, cookie, { httpOnly: true, sameSite: "lax", secure: true, path: "/api/auth/google", maxAge: 600 });
  return res;
}
