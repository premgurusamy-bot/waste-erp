import { notFound } from "next/navigation";
import { saveEntityAction } from "@/app/actions/masters";
import { EntityForm } from "@/components/forms/entity-form";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { customerFields, toFormValues } from "@/lib/fields";
import { requirePermission } from "@/server/auth/current-user";

export default async function EditCustomer({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("customers.manage");
  const { id } = await params;
  const c = await prisma.customer.findUnique({ where: { id } });
  if (!c) notFound();
  return (
    <>
      <PageHeader title={`Edit ${c.name}`} description={c.code} crumbs={[{ href: "/customers", label: "Customers" }, { href: `/customers/${id}`, label: c.name }]} />
      <Card>
        <CardContent>
          <EntityForm
            schemaKey="customer"
            fields={customerFields()}
            defaultValues={toFormValues(c)}
            action={saveEntityAction.bind(null, "customer", id)}
            redirectTo={`/customers/${id}`}
            successMessage="Customer updated"
            cancelHref={`/customers/${id}`}
          />
        </CardContent>
      </Card>
    </>
  );
}
