import { ArrowLeft, MapPin } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CollectionForm } from "@/components/forms/collection-form";
import { prisma } from "@/lib/db";
import { toLocalInput } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { customerOptions, driverOptions, siteOptions, vehicleOptions, wasteTypeOptions } from "@/server/options";

export default async function FieldCollect({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("collections.manage");
  const { id } = await params;
  const s = await prisma.collectionSchedule.findUnique({ where: { id }, include: { customer: true, site: true, wasteType: true, collectionEntry: true } });
  if (!s) notFound();
  const [customers, sites, wasteTypes, vehicles, drivers] = await Promise.all([customerOptions(), siteOptions(), wasteTypeOptions(), vehicleOptions(), driverOptions()]);
  return (
    <div className="mx-auto max-w-xl">
      <Link href="/field" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-600"><ArrowLeft className="size-4" /> Today&apos;s tasks</Link>
      <div className="mb-4 rounded-2xl bg-navy-800 p-4 text-white">
        <p className="text-xs uppercase tracking-wide text-navy-200">Collection at</p>
        <p className="text-xl font-semibold">{s.customer.name}</p>
        <p className="flex items-center gap-1 text-sm text-navy-100"><MapPin className="size-4" /> {s.site.name}</p>
        <p className="mt-1 text-sm text-brand-300">{s.wasteType.name}{s.scheduledTime ? ` · ${s.scheduledTime}` : ""}</p>
      </div>
      {s.collectionEntry ? (
        <p className="rounded-xl bg-brand-50 p-4 text-brand-800">This collection is already recorded ({s.collectionEntry.number}).</p>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <CollectionForm
            field
            lockParty
            customers={customers}
            sites={sites}
            wasteTypes={wasteTypes}
            vehicles={vehicles}
            drivers={drivers}
            defaults={{ scheduleId: s.id, customerId: s.customerId, siteId: s.siteId, wasteTypeId: s.wasteTypeId, vehicleId: s.vehicleId ?? "", driverId: s.driverId ?? "", collectionDate: toLocalInput(new Date()) }}
            redirectTo="/field"
          />
        </div>
      )}
    </div>
  );
}
