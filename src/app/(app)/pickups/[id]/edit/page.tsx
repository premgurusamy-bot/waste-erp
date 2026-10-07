import { notFound } from "next/navigation";
import { savePickupAction } from "@/app/actions/operations";
import { EntityForm } from "@/components/forms/entity-form";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { toFormValues } from "@/lib/fields";
import { pickupFields } from "@/lib/ops-fields";
import { requirePermission } from "@/server/auth/current-user";
import { customerOptions, siteOptions, wasteTypeOptions } from "@/server/options";

export default async function EditPickup({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("pickups.manage");
  const { id } = await params;
  const p = await prisma.pickupRequest.findUnique({ where: { id } });
  if (!p) notFound();
  const [c, s, w] = await Promise.all([customerOptions(), siteOptions(), wasteTypeOptions()]);
  return (
    <>
      <PageHeader title={`Edit ${p.number}`} crumbs={[{ href: "/pickups", label: "Pickups" }]} />
      <Card><CardContent>
        <EntityForm schemaKey="pickup" fields={pickupFields(c, s, w)} defaultValues={toFormValues(p)} action={savePickupAction.bind(null, id)} redirectTo="/pickups" cancelHref="/pickups" />
      </CardContent></Card>
    </>
  );
}
