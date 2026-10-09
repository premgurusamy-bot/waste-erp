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

export function Sidebar({ nav, company }: { nav: NavGroup[]; company: string }) {
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
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <Link href="/dashboard" className="flex h-14 items-center gap-2.5 border-b border-white/10 px-4">
          <img src="/icon.svg" alt="" className="size-8" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">GreenCycle ERP</p>
            <p className="truncate text-[11px] text-navy-300">{company}</p>
          </div>
        </Link>
        <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Main">
          {nav.map((g) => (
            <div key={g.label} className="mb-3">
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-navy-400">{g.label}</p>
              {g.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                      active ? "bg-brand-600 font-medium text-white shadow-sm" : "text-navy-100 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    <Icon name={item.icon} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <p className="border-t border-white/10 px-4 py-3 text-[10px] text-navy-400">v1.2 · Non-hazardous waste</p>
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
