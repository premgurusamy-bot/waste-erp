import { redirect } from "next/navigation";
import { brandingUrl } from "@/lib/appearance";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/server/auth/current-user";
import { getAppearance } from "@/server/branding";
import { googleEnabled } from "@/server/auth/google";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  if (await getCurrentUser()) redirect("/dashboard");
  const { next, error } = await searchParams;
  const [look, google, company] = await Promise.all([getAppearance(), googleEnabled(), prisma.company.findFirst({ select: { name: true } }).catch(() => null)]);
  const logo = brandingUrl(look.logo);
  const photo = brandingUrl(look.loginImage);
  const brand = (size: string) =>
    logo ? (
      <span className={`flex ${size} shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white p-1`}><img src={logo} alt="" className="max-h-full max-w-full object-contain" /></span>
    ) : (
      <img src="/icon.svg" alt="" className={size} />
    );
  const title = logo && company?.name ? company.name : "GreenCycle ERP";
  return (
    <div className="flex min-h-screen">
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-navy-800 p-12 text-white lg:flex">
        {photo ? (
          <>
            <img src={photo} alt="" className="absolute inset-0 size-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-navy-900/90 via-navy-900/50 to-navy-900/30" />
          </>
        ) : (
          <>
            <div className="absolute -right-24 -top-24 size-96 rounded-full bg-brand-600/20 blur-3xl" />
            <div className="absolute -bottom-32 -left-16 size-96 rounded-full bg-brand-500/10 blur-3xl" />
          </>
        )}
        <div className="relative flex items-center gap-3">
          {brand("size-11")}
          <span className="text-lg font-semibold">{title}</span>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-3xl font-semibold leading-tight">Waste management operations, from pickup to payment.</h1>
          <p className="mt-4 text-navy-200">
            Collection scheduling, weighbridge, segregation &amp; processing, recyclable sales, customer billing, GST and accounts — in one traceable system.
          </p>
          <div className="mt-8 flex flex-wrap gap-2 text-xs text-navy-100">
            {["Customer", "Pickup", "Weighment", "Processing", "Sales", "Billing", "Payment"].map((s, i) => (
              <span key={s} className="flex items-center gap-2">
                <span className="rounded-full border border-white/20 bg-white/5 px-3 py-1">{s}</span>
                {i < 6 && <span className="text-brand-400">→</span>}
              </span>
            ))}
          </div>
        </div>
        <p className="relative text-xs text-navy-300">Non-hazardous waste only. © GreenCycle ERP</p>
      </div>
      <div className="flex flex-1 items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            {brand("size-10")}
            <span className="text-lg font-semibold text-navy-800">{title}</span>
          </div>
          <h2 className="text-2xl font-semibold text-navy-800">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Use the username and password given by your administrator.</p>
          <LoginForm next={next} google={google} error={error?.slice(0, 300)} />
        </div>
      </div>
    </div>
  );
}
