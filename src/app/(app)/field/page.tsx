import { CheckCircle2, ChevronRight, Clock, MapPin, Phone, Recycle, Truck } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/badge";
import { prisma } from "@/lib/db";
import { str, type SP } from "@/lib/list-params";
import { cn, dateOnly, formatDate, todayISO } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";

export const metadata = { title: "Today's Tasks" };

export default async function FieldPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("collections.manage");
  const sp = await searchParams;
  const vehicleId = str(sp, "vehicleId");
  const today = dateOnly(todayISO());
  const [tasks, vehicles, done] = await Promise.all([
    prisma.collectionSchedule.findMany({
      where: { scheduledDate: today, status: { in: ["ASSIGNED", "IN_PROGRESS", "SCHEDULED"] }, ...(vehicleId ? { vehicleId } : {}) },
      include: { customer: true, site: true, wasteType: true, vehicle: true, driver: true },
      orderBy: [{ status: "desc" }, { scheduledTime: "asc" }],
    }),
    prisma.vehicle.findMany({ where: { status: "ACTIVE" }, orderBy: { number: "asc" } }),
    prisma.collectionSchedule.count({ where: { scheduledDate: today, status: "COMPLETED", ...(vehicleId ? { vehicleId } : {}) } }),
  ]);
  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold text-navy-800">Today&apos;s Tasks</h1>
        <p className="text-sm text-slate-500">{formatDate(today)} · {tasks.length} pending · {done} completed</p>
      </div>
      <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1">
        <Link href="/field" className={cn("whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium", !vehicleId ? "border-navy-700 bg-navy-700 text-white" : "border-slate-300 bg-white")}>All vehicles</Link>
        {vehicles.map((v) => (
          <Link key={v.id} href={`/field?vehicleId=${v.id}`} className={cn("whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium", vehicleId === v.id ? "border-navy-700 bg-navy-700 text-white" : "border-slate-300 bg-white")}>{v.number}</Link>
        ))}
      </div>
      {tasks.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
          <CheckCircle2 className="mx-auto size-12 text-brand-500" />
          <p className="mt-3 text-lg font-medium">All done for today</p>
          <p className="text-sm text-slate-500">No pending collections.</p>
        </div>
      )}
      <ul className="space-y-3">
        {tasks.map((t) => (
          <li key={t.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-lg font-semibold text-navy-800">{t.customer.name}</p>
                <p className="flex items-center gap-1 text-sm text-slate-600"><MapPin className="size-4 shrink-0" /> {t.site.name}</p>
                {t.site.address && <p className="ml-5 text-xs text-slate-500">{t.site.address}</p>}
              </div>
              <StatusBadge status={t.status} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <span className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-2"><Clock className="size-4 text-slate-400" />{t.scheduledTime ?? "Any"}</span>
              <span className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-2"><Recycle className="size-4 text-brand-600" />{t.wasteType.name}</span>
              <span className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-2"><Truck className="size-4 text-slate-400" />{t.vehicle?.number.slice(-7) ?? "—"}</span>
            </div>
            <div className="mt-3 flex gap-2">
              {t.site.latitude && (
                <a href={`https://maps.google.com/?q=${t.site.latitude},${t.site.longitude}`} target="_blank" className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-300 text-sm font-medium"><MapPin className="size-5" /> Navigate</a>
              )}
              {t.site.contactMobile && (
                <a href={`tel:${t.site.contactMobile}`} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-300 text-sm font-medium"><Phone className="size-5" /> Call</a>
              )}
              <Link href={`/field/${t.id}`} className="flex h-12 flex-[2] items-center justify-center gap-2 rounded-xl bg-brand-600 text-base font-semibold text-white">
                Collect <ChevronRight className="size-5" />
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
