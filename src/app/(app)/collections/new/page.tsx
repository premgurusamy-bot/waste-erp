import { CollectionForm } from "@/components/forms/collection-form";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { str, type SP } from "@/lib/list-params";
import { toLocalInput } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { customerOptions, driverOptions, siteOptions, vehicleOptions, wasteTypeOptions } from "@/server/options";

export const metadata = { title: "Record Collection" };

export default async function NewCollection({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("collections.manage");
  const sp = await searchParams;
  const scheduleId = str(sp, "scheduleId");
  const s = scheduleId ? await prisma.collectionSchedule.findUnique({ where: { id: scheduleId }, include: { customer: true, site: true } }) : null;
  const [customers, sites, wasteTypes, vehicles, drivers] = await Promise.all([customerOptions(), siteOptions(), wasteTypeOptions(), vehicleOptions(), driverOptions()]);
  const defaults: Record<string, string> = { collectionDate: toLocalInput(new Date()) };
  if (s) Object.assign(defaults, { scheduleId: s.id, customerId: s.customerId, siteId: s.siteId, wasteTypeId: s.wasteTypeId, vehicleId: s.vehicleId ?? "", driverId: s.driverId ?? "" });
  return (
    <>
      <PageHeader title="Record Collection" description={s ? `Completing schedule ${s.number} · ${s.customer.name} · ${s.site.name}` : "Ad-hoc collection entry"} crumbs={[{ href: "/collections", label: "Collections" }]} />
      <Card><CardContent>
        <CollectionForm customers={customers} sites={sites} wasteTypes={wasteTypes} vehicles={vehicles} drivers={drivers} defaults={defaults} lockParty={!!s} redirectTo={s ? "/schedule" : "/collections"} />
      </CardContent></Card>
    </>
  );
}
