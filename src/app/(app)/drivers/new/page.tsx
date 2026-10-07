import { saveEntityAction } from "@/app/actions/masters";
import { EntityForm } from "@/components/forms/entity-form";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { driverFields } from "@/lib/fields";
import { requirePermission } from "@/server/auth/current-user";

export const metadata = { title: "New Driver" };

export default async function NewDriver() {
  await requirePermission("drivers.manage");
  return (
    <>
      <PageHeader title="New Driver" description="Driver code is generated automatically" crumbs={[{ href: "/drivers", label: "Drivers" }]} />
      <Card><CardContent>
        <EntityForm schemaKey="driver" fields={driverFields()} defaultValues={{ status: "ACTIVE" }} action={saveEntityAction.bind(null, "driver", null)} submitLabel="Create Driver" redirectTo="/drivers/:id" cancelHref="/drivers" />
      </CardContent></Card>
    </>
  );
}
