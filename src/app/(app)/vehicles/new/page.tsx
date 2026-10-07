import { saveEntityAction } from "@/app/actions/masters";
import { EntityForm } from "@/components/forms/entity-form";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { vehicleFields } from "@/lib/fields";
import { requirePermission } from "@/server/auth/current-user";
import { driverOptions } from "@/server/options";

export const metadata = { title: "New Vehicle" };

export default async function NewVehicle() {
  await requirePermission("vehicles.manage");
  return (
    <>
      <PageHeader title="New Vehicle" crumbs={[{ href: "/vehicles", label: "Vehicles" }]} />
      <Card><CardContent>
        <EntityForm schemaKey="vehicle" fields={vehicleFields(await driverOptions())} defaultValues={{ status: "ACTIVE", fuelType: "DIESEL", ownership: "OWNED" }} action={saveEntityAction.bind(null, "vehicle", null)} submitLabel="Create Vehicle" redirectTo="/vehicles/:id" cancelHref="/vehicles" />
      </CardContent></Card>
    </>
  );
}
