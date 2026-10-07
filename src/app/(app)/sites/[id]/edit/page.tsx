import { notFound } from "next/navigation";
import { saveEntityAction } from "@/app/actions/masters";
import { EntityForm } from "@/components/forms/entity-form";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { siteFields, toFormValues } from "@/lib/fields";
import { requirePermission } from "@/server/auth/current-user";
import { customerOptions, wasteTypeOptions } from "@/server/options";

export default async function EditSite({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("customers.manage");
  const { id } = await params;
  const s = await prisma.customerSite.findUnique({ where: { id } });
  if (!s) notFound();
  const [customers, wasteTypes] = await Promise.all([customerOptions(true), wasteTypeOptions()]);
  return (
    <>
      <PageHeader title={`Edit ${s.name}`} crumbs={[{ href: "/sites", label: "Sites" }, { href: `/sites/${id}`, label: s.name }]} />
      <Card>
        <CardContent>
          <EntityForm schemaKey="site" fields={siteFields(customers, wasteTypes)} defaultValues={toFormValues(s)} action={saveEntityAction.bind(null, "site", id)} redirectTo={`/sites/${id}`} cancelHref={`/sites/${id}`} />
        </CardContent>
      </Card>
    </>
  );
}
