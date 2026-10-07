import { saveEntityAction } from "@/app/actions/masters";
import { EntityForm } from "@/components/forms/entity-form";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { customerFields } from "@/lib/fields";
import { requirePermission } from "@/server/auth/current-user";

export const metadata = { title: "New Customer" };

export default async function NewCustomer() {
  await requirePermission("customers.manage");
  return (
    <>
      <PageHeader title="New Customer" description="The customer code is generated automatically" crumbs={[{ href: "/customers", label: "Customers" }]} />
      <Card>
        <CardContent>
          <EntityForm
            schemaKey="customer"
            fields={customerFields()}
            defaultValues={{ status: "ACTIVE", creditDays: "30" }}
            action={saveEntityAction.bind(null, "customer", null)}
            submitLabel="Create Customer"
            redirectTo="/customers/:id"
            successMessage="Customer created"
            cancelHref="/customers"
          />
        </CardContent>
      </Card>
    </>
  );
}
