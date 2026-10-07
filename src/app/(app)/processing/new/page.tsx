import { ProcessingForm } from "@/components/forms/processing-form";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { num, todayISO } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { itemOptions, locationOptions } from "@/server/options";

export const metadata = { title: "New Processing Batch" };

export default async function NewProcessing() {
  await requirePermission("processing.manage");
  const [inputItems, outputItems, locations, balances, yard] = await Promise.all([
    itemOptions({ itemType: "RAW" }),
    itemOptions({ itemType: { in: ["RECOVERED", "OTHER"] } }),
    locationOptions(),
    prisma.inventoryBalance.findMany(),
    prisma.location.findFirst({ where: { type: "YARD", status: "ACTIVE" } }),
  ]);
  const stock = Object.fromEntries(balances.map((b) => [`${b.itemId}|${b.locationId}`, num(b.quantity)]));
  return (
    <>
      <PageHeader title="New Processing Batch" description="Segregate received waste into recovered materials. Stock is issued and received when the batch is posted." crumbs={[{ href: "/processing", label: "Processing" }]} />
      <Card><CardContent>
        <ProcessingForm inputItems={inputItems} outputItems={outputItems} locations={locations} stock={stock} defaults={{ date: todayISO(), locationId: yard?.id ?? "", batchNo: `B-${todayISO().replace(/-/g, "")}` }} />
      </CardContent></Card>
    </>
  );
}
