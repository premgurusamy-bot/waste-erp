import { notFound } from "next/navigation";
import { saveEntityAction } from "@/app/actions/masters";
import { EntityForm } from "@/components/forms/entity-form";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { toFormValues, vehicleFields } from "@/lib/fields";
import { requirePermission } from "@/server/auth/current-user";
import { driverOptions } from "@/server/options";

export default async function EditVehicle({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("vehicles.manage");
  const { id } = await params;
  const v = await prisma.vehicle.findUnique({ where: { id } });
  if (!v) notFound();
  return (
    <>
      <PageHeader title={`Edit ${v.number}`} crumbs={[{ href: "/vehicles", label: "Vehicles" }, { href: `/vehicles/${id}`, label: v.number }]} />
      <Card><CardContent>
        <EntityForm schemaKey="vehicle" fields={vehicleFields(await driverOptions())} defaultValues={toFormValues(v)} action={saveEntityAction.bind(null, "vehicle", id)} redirectTo={`/vehicles/${id}`} cancelHref={`/vehicles/${id}`} />
      </CardContent></Card>
    </>
  );
}
