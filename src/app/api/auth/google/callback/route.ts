import { NextResponse } from "next/server";
import { cookieOptions, SESSION_COOKIE, signSession } from "@/server/auth/session";
import { finishGoogleSignIn, getAccessConfig, issueAppCode, readFlowCookie, userForGoogleEmail } from "@/server/auth/google";
import { AppError } from "@/server/errors";

const FLOW_COOKIE = "g_signin";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const cfg = await getAccessConfig();
  const base = cfg.publicUrl ?? url.origin;
  const fail = (msg: string) => {
    const r = NextResponse.redirect(`${base}/login?error=${encodeURIComponent(msg)}`);
    r.cookies.delete({ name: FLOW_COOKIE, path: "/api/auth/google" });
    return r;
  };
  const flow = await readFlowCookie(req.headers.get("cookie")?.match(/(?:^|;\s*)g_signin=([^;]+)/)?.[1]);
  if (!flow || url.searchParams.get("state") !== flow.state) return fail("The Google sign-in took too long or was started elsewhere. Please try again.");
  if (url.searchParams.get("error")) return fail("Google sign-in was cancelled.");
  const code = url.searchParams.get("code");
  if (!code) return fail("Google did not return a sign-in code.");
  try {
    const email = await finishGoogleSignIn(cfg, flow, code);
    const user = await userForGoogleEmail(email, { ip: (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null, userAgent: req.headers.get("user-agent")?.slice(0, 250) ?? null });
    if (flow.app) {
      // Hand the sign-in back to the Android app, which opens this link inside itself.
      const link = `greencycle://login?code=${encodeURIComponent(await issueAppCode(user.id, user.sessionVersion))}`;
      const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Signed in</title></head>
<body style="font-family:sans-serif;text-align:center;padding:48px 20px;color:#0f172a">
<h2>Signed in as ${user.name.replace(/[<>&"]/g, "")}</h2><p>Returning to the GreenCycle app…</p>
<p><a href="${link}" style="display:inline-block;margin-top:16px;padding:14px 22px;background:#039855;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Open GreenCycle app</a></p>
<script>location.href=${JSON.stringify(link)}</script></body></html>`;
      const r = new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
      r.cookies.delete({ name: FLOW_COOKIE, path: "/api/auth/google" });
      return r;
    }
    const r = NextResponse.redirect(base + (user.mustChangePassword ? "/profile?force=1" : flow.next));
    r.cookies.set(SESSION_COOKIE, await signSession({ uid: user.id, sv: user.sessionVersion }), cookieOptions());
    r.cookies.delete({ name: FLOW_COOKIE, path: "/api/auth/google" });
    return r;
  } catch (e) {
    console.error("[google sign-in]", e instanceof AppError ? e.message : e);
    return fail(e instanceof AppError ? e.message : "Google sign-in failed. Please try again or use your username and password.");
  }
}
