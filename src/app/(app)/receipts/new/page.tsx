import { MoneyForm } from "@/components/forms/money-form";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { str, type SP } from "@/lib/list-params";
import { todayISO } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { buyerOptions, cashBankOptions, customerOptions } from "@/server/options";

export const metadata = { title: "New Receipt" };

export default async function NewReceipt({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("receipts.manage");
  const sp = await searchParams;
  const [customers, buyers, accounts] = await Promise.all([customerOptions(true), buyerOptions(), cashBankOptions()]);
  const buyerId = str(sp, "buyerId");
  return (
    <>
      <PageHeader title="New Receipt" description="Record money received and allocate it to invoices. Any unallocated amount stays as an advance." crumbs={[{ href: "/receipts", label: "Receipts" }]} />
      <Card><CardContent>
        <MoneyForm kind="receipt" customers={customers} buyers={buyers} accounts={accounts} defaults={{ date: todayISO(), partyType: buyerId ? "BUYER" : "CUSTOMER", partyId: buyerId ?? str(sp, "customerId"), accountId: accounts.find((a) => a.label.includes("Bank"))?.value }} />
      </CardContent></Card>
    </>
  );
}
