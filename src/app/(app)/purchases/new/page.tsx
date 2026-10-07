import { TradeForm } from "@/components/forms/trade-form";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { todayISO } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { tradeContext } from "@/server/trade-options";

export const metadata = { title: "New Purchase" };

export default async function NewPurchase() {
  await requirePermission("purchases.manage");
  const t = await tradeContext("purchase");
  return (
    <>
      <PageHeader title="New Purchase" description="Select a stock item to add it to inventory, or leave blank for services/consumables. Attach the bill after saving." crumbs={[{ href: "/purchases", label: "Purchases" }]} />
      <Card><CardContent>
        <TradeForm mode="purchase" parties={t.parties} items={t.items} locations={t.locations} companyState={t.companyState} roundOff={t.roundOff} defaults={{ date: todayISO(), locationId: t.defaultLocation }} />
      </CardContent></Card>
    </>
  );
}
