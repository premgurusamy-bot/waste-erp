"use client";

import * as Icons from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { NavGroup } from "@/lib/permissions";
import { cn } from "@/lib/utils";

function Icon({ name }: { name: string }) {
  const C = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[name] ?? Icons.Circle;
  return <C className="size-4 shrink-0" />;
}

export function Sidebar({ nav, company, logo, compact }: { nav: NavGroup[]; company: string; logo: string | null; compact: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const h = () => setOpen((o) => !o);
    window.addEventListener("toggle-sidebar", h);
    return () => window.removeEventListener("toggle-sidebar", h);
  }, []);
  return (
    <>
      <div className={cn("fixed inset-0 z-30 bg-navy-900/40 lg:hidden", open ? "block" : "hidden")} onClick={() => setOpen(false)} />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-navy-800 text-navy-100 transition-transform lg:translate-x-0",
          compact && "lg:w-16",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <Link href="/dashboard" className={cn("flex h-14 items-center gap-2.5 border-b border-white/10 px-4", compact && "lg:justify-center lg:px-2")} title={company}>
          {logo ? (
            <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-0.5">
              <img src={logo} alt="" className="max-h-full max-w-full object-contain" />
            </span>
          ) : (
            <img src="/icon.svg" alt="" className="size-8 shrink-0" />
          )}
          <div className={cn("min-w-0", compact && "lg:hidden")}>
            <p className="truncate text-sm font-semibold text-white">{logo ? company : "GreenCycle ERP"}</p>
            <p className="truncate text-[11px] text-navy-300">{logo ? "GreenCycle ERP" : company}</p>
          </div>
        </Link>
        <nav className={cn("flex-1 overflow-y-auto px-2 py-3", compact && "lg:px-2")} aria-label="Main">
          {nav.map((g) => (
            <div key={g.label} className="mb-3">
              <p className={cn("px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-navy-400", compact && "lg:hidden")}>{g.label}</p>
              {compact && <div className="mx-2 mb-1 hidden border-t border-white/10 lg:block" />}
              {g.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={compact ? item.label : undefined}
                    className={cn(
                      "mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                      compact && "lg:justify-center lg:px-0",
                      active ? "bg-brand-600 font-medium text-white shadow-sm" : "text-navy-100 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    <Icon name={item.icon} />
                    <span className={cn(compact && "lg:hidden")}>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <p className={cn("border-t border-white/10 px-4 py-3 text-[10px] text-navy-400", compact && "lg:px-1 lg:text-center")}>{compact ? "v1.3" : "v1.3 · Non-hazardous waste"}</p>
      </aside>
    </>
  );
}

export function MenuButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("toggle-sidebar"))}
      className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
      aria-label="Open menu"
    >
      <Icons.Menu className="size-5" />
    </button>
  );
}
