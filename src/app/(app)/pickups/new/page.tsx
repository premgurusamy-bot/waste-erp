import { savePickupAction } from "@/app/actions/operations";
import { EntityForm } from "@/components/forms/entity-form";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { str, type SP } from "@/lib/list-params";
import { pickupFields } from "@/lib/ops-fields";
import { todayISO } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { customerOptions, siteOptions, wasteTypeOptions } from "@/server/options";

export const metadata = { title: "New Pickup" };

export default async function NewPickup({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("pickups.manage");
  const sp = await searchParams;
  const [c, s, w] = await Promise.all([customerOptions(), siteOptions(), wasteTypeOptions()]);
  return (
    <>
      <PageHeader title="New Pickup Request" crumbs={[{ href: "/pickups", label: "Pickups" }]} />
      <Card><CardContent>
        <EntityForm schemaKey="pickup" fields={pickupFields(c, s, w)} defaultValues={{ customerId: str(sp, "customerId") ?? "", requestedDate: todayISO(), priority: "NORMAL" }} action={savePickupAction.bind(null, null)} submitLabel="Create Pickup" redirectTo="/pickups" successMessage="Pickup request created" cancelHref="/pickups" />
      </CardContent></Card>
    </>
  );
}
