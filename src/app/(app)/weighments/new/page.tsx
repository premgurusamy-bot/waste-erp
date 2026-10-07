import { gateInAction } from "@/app/actions/weighments";
import { EntityForm } from "@/components/forms/entity-form";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { str, type SP } from "@/lib/list-params";
import { toLocalInput } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { customerOptions, driverOptions, locationOptions, siteOptions, vehicleOptions, wasteTypeOptions } from "@/server/options";

export const metadata = { title: "Gate In" };

export default async function GateInPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("weighments.manage");
  const sp = await searchParams;
  const colId = str(sp, "collectionId");
  const col = colId ? await prisma.collectionEntry.findUnique({ where: { id: colId } }) : null;
  const collectionId = col?.id;
  const [customers, sites, wasteTypes, vehicles, drivers, locations] = await Promise.all([customerOptions(), siteOptions(), wasteTypeOptions(), vehicleOptions(true), driverOptions(), locationOptions()]);
  const yard = await prisma.location.findFirst({ where: { type: "YARD", status: "ACTIVE" } });
  return (
    <>
      <PageHeader title="Weighbridge · Gate In" description="Record the loaded (gross) weight as the vehicle enters" crumbs={[{ href: "/weighments", label: "Weighment" }]} />
      <Card><CardContent>
        <EntityForm
          schemaKey="gateIn"
          fields={[
            { name: "vehicleId", label: "Vehicle", type: "select", options: vehicles, required: true, section: "Vehicle & source" },
            { name: "driverId", label: "Driver", type: "select", options: drivers },
            { name: "gateInAt", label: "Gate-in Date & Time", type: "datetime", required: true },
            { name: "customerId", label: "Customer", type: "select", options: customers, required: true },
            { name: "siteId", label: "Site", type: "select", options: sites, filterBy: "customerId" },
            { name: "wasteTypeId", label: "Waste Type", type: "select", options: wasteTypes, required: true },
            { name: "grossWeight", label: "Gross Weight (KG)", type: "number", required: true, section: "Weighbridge reading" },
            { name: "slipNumber", label: "Weighbridge Slip No.", help: "Must be unique" },
            { name: "locationId", label: "Receiving Location", type: "select", options: locations, required: true },
            { name: "remarks", label: "Remarks", type: "textarea" },
          ]}
          defaultValues={{
            gateInAt: toLocalInput(new Date()),
            locationId: yard?.id ?? "",
            ...(col ? { collectionEntryId: col.id, vehicleId: col.vehicleId, driverId: col.driverId ?? "", customerId: col.customerId, siteId: col.siteId, wasteTypeId: col.wasteTypeId } : {}),
          }}
          action={col ? async (v) => { "use server"; return gateInAction({ ...v, collectionEntryId: collectionId }); } : gateInAction}
          submitLabel="Record Gate In"
          redirectTo="/weighments/:id"
          successMessage="Gate-in recorded"
          cancelHref="/weighments"
        />
      </CardContent></Card>
    </>
  );
}
