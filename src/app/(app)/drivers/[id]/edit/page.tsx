import { notFound } from "next/navigation";
import { saveEntityAction } from "@/app/actions/masters";
import { EntityForm } from "@/components/forms/entity-form";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { driverFields, toFormValues } from "@/lib/fields";
import { requirePermission } from "@/server/auth/current-user";

export default async function EditDriver({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("drivers.manage");
  const { id } = await params;
  const d = await prisma.driver.findUnique({ where: { id } });
  if (!d) notFound();
  return (
    <>
      <PageHeader title={`Edit ${d.name}`} crumbs={[{ href: "/drivers", label: "Drivers" }, { href: `/drivers/${id}`, label: d.name }]} />
      <Card><CardContent>
        <EntityForm schemaKey="driver" fields={driverFields()} defaultValues={toFormValues(d)} action={saveEntityAction.bind(null, "driver", id)} redirectTo={`/drivers/${id}`} cancelHref={`/drivers/${id}`} />
      </CardContent></Card>
    </>
  );
}
