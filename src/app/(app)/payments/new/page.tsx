import { MoneyForm } from "@/components/forms/money-form";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { str, type SP } from "@/lib/list-params";
import { todayISO } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { cashBankOptions, supplierOptions } from "@/server/options";

export const metadata = { title: "New Supplier Payment" };

export default async function NewPayment({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("receipts.manage");
  const sp = await searchParams;
  const [suppliers, accounts] = await Promise.all([supplierOptions(), cashBankOptions()]);
  return (
    <>
      <PageHeader title="New Supplier Payment" crumbs={[{ href: "/payments", label: "Payments" }]} />
      <Card><CardContent>
        <MoneyForm kind="payment" suppliers={suppliers} accounts={accounts} defaults={{ date: todayISO(), partyId: str(sp, "supplierId"), accountId: accounts.find((a) => a.label.includes("Bank"))?.value }} />
      </CardContent></Card>
    </>
  );
}
