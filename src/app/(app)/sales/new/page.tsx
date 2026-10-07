import { TradeForm } from "@/components/forms/trade-form";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { todayISO } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { tradeContext } from "@/server/trade-options";

export const metadata = { title: "New Sale" };

export default async function NewSale() {
  await requirePermission("sales.manage");
  const t = await tradeContext("sale");
  return (
    <>
      <PageHeader title="New Recyclable Sale" description="Sale, invoice and stock reduction are saved together — if stock is insufficient nothing is saved" crumbs={[{ href: "/sales", label: "Sales" }]} />
      <Card><CardContent>
        <TradeForm mode="sale" parties={t.parties} items={t.items} locations={t.locations} stock={t.stock} companyState={t.companyState} roundOff={t.roundOff} defaults={{ date: todayISO(), locationId: t.defaultLocation }} />
      </CardContent></Card>
    </>
  );
}
