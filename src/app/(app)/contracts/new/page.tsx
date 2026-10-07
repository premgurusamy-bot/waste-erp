import { saveContractAction } from "@/app/actions/contracts";
import { EntityForm } from "@/components/forms/entity-form";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { contractFields } from "@/lib/contract-fields";
import { str, type SP } from "@/lib/list-params";
import { todayISO } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { customerOptions } from "@/server/options";

export const metadata = { title: "New Contract" };

export default async function NewContract({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("contracts.manage");
  const sp = await searchParams;
  return (
    <>
      <PageHeader title="New Contract" description="Add rates after saving the contract" crumbs={[{ href: "/contracts", label: "Contracts" }]} />
      <Card><CardContent>
        <EntityForm schemaKey="contract" fields={contractFields(await customerOptions())} defaultValues={{ customerId: str(sp, "customerId") ?? "", status: "ACTIVE", startDate: todayISO(), paymentTermsDays: "30" }} action={saveContractAction.bind(null, null)} submitLabel="Create Contract" redirectTo="/contracts/:id" cancelHref="/contracts" />
      </CardContent></Card>
    </>
  );
}
