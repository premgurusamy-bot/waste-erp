"use client";

import * as DM from "@radix-ui/react-dropdown-menu";
import { AlertTriangle, Bell, CircleAlert, Info, KeyRound, LogOut, Search, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { logout, markReadAction } from "@/app/actions/auth";
import { cn } from "@/lib/utils";
import { MenuButton } from "./sidebar";

type Note = { id: string; title: string; message: string; link: string | null; severity: string; read: boolean };

export function Topbar({ user, notifications }: { user: { name: string; roleNames: string[] }; notifications: Note[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [, start] = useTransition();
  const unread = notifications.filter((n) => !n.read).length;
  const sevIcon = (s: string) =>
    s === "CRITICAL" ? <CircleAlert className="size-4 text-red-600" /> : s === "WARNING" ? <AlertTriangle className="size-4 text-amber-500" /> : <Info className="size-4 text-navy-500" />;
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/95 px-3 backdrop-blur sm:px-5">
      <MenuButton />
      <form
        className="relative max-w-md flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim().length >= 2) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
        }}
        role="search"
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search customers, invoices, vehicles, weighments…"
          aria-label="Global search"
          className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
      </form>
      <div className="ml-auto flex items-center gap-1">
        <DM.Root
          onOpenChange={(o) => {
            if (!o && unread) start(async () => { await markReadAction(notifications.filter((n) => !n.read).map((n) => n.id)); router.refresh(); });
          }}
        >
          <DM.Trigger className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Notifications">
            <Bell className="size-5" />
            {unread > 0 && (
              <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-semibold text-white">{unread > 9 ? "9+" : unread}</span>
            )}
          </DM.Trigger>
          <DM.Portal>
            <DM.Content align="end" sideOffset={6} className="z-50 w-[22rem] max-w-[calc(100vw-1rem)] rounded-xl border border-slate-200 bg-white shadow-xl">
              <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-navy-800">Alerts</div>
              <div className="max-h-96 overflow-y-auto">
                {notifications.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-500">You are all caught up.</p>}
                {notifications.map((n) => (
                  <DM.Item key={n.id} asChild>
                    <Link href={n.link ?? "#"} className={cn("flex gap-3 border-b border-slate-50 px-4 py-2.5 outline-none hover:bg-slate-50 focus:bg-slate-50", !n.read && "bg-brand-50/40")}>
                      <span className="mt-0.5">{sevIcon(n.severity)}</span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-slate-800">{n.title}</span>
                        <span className="block text-xs text-slate-500">{n.message}</span>
                      </span>
                    </Link>
                  </DM.Item>
                ))}
              </div>
            </DM.Content>
          </DM.Portal>
        </DM.Root>
        <DM.Root>
          <DM.Trigger className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-100" aria-label="User menu">
            <span className="flex size-8 items-center justify-center rounded-full bg-navy-700 text-xs font-semibold text-white">
              {user.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
            </span>
            <span className="hidden text-left sm:block">
              <span className="block text-sm font-medium leading-tight text-slate-800">{user.name}</span>
              <span className="block text-[11px] leading-tight text-slate-500">{user.roleNames.join(", ")}</span>
            </span>
          </DM.Trigger>
          <DM.Portal>
            <DM.Content align="end" sideOffset={6} className="z-50 min-w-48 rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
              <DM.Item asChild>
                <Link href="/profile" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none hover:bg-slate-50 focus:bg-slate-50"><UserRound className="size-4" /> My profile</Link>
              </DM.Item>
              <DM.Item asChild>
                <Link href="/profile" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none hover:bg-slate-50 focus:bg-slate-50"><KeyRound className="size-4" /> Change password</Link>
              </DM.Item>
              <DM.Separator className="my-1 h-px bg-slate-100" />
              <DM.Item asChild>
                <form action={logout}>
                  <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 outline-none hover:bg-red-50 focus:bg-red-50"><LogOut className="size-4" /> Sign out</button>
                </form>
              </DM.Item>
            </DM.Content>
          </DM.Portal>
        </DM.Root>
      </div>
    </header>
  );
}
