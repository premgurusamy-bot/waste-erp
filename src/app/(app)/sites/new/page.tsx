import { saveEntityAction } from "@/app/actions/masters";
import { EntityForm } from "@/components/forms/entity-form";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { siteFields } from "@/lib/fields";
import { str, type SP } from "@/lib/list-params";
import { requirePermission } from "@/server/auth/current-user";
import { customerOptions, wasteTypeOptions } from "@/server/options";

export const metadata = { title: "New Site" };

export default async function NewSite({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("customers.manage");
  const sp = await searchParams;
  const [customers, wasteTypes] = await Promise.all([customerOptions(), wasteTypeOptions()]);
  return (
    <>
      <PageHeader title="New Customer Site" crumbs={[{ href: "/sites", label: "Sites" }]} />
      <Card>
        <CardContent>
          <EntityForm
            schemaKey="site"
            fields={siteFields(customers, wasteTypes)}
            defaultValues={{ customerId: str(sp, "customerId") ?? "", status: "ACTIVE", frequency: "DAILY" }}
            action={saveEntityAction.bind(null, "site", null)}
            submitLabel="Create Site"
            redirectTo="/sites/:id"
            cancelHref="/sites"
          />
        </CardContent>
      </Card>
    </>
  );
}
