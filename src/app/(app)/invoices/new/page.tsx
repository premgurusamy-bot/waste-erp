import { InvoiceForm } from "@/components/forms/invoice-form";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { str, type SP } from "@/lib/list-params";
import { num, todayISO } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { customerOptions, siteOptions } from "@/server/options";
import { invoicePeriodDefaults } from "@/server/services/billing";

export const metadata = { title: "Generate Invoice" };

export default async function NewInvoice({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("billing.manage");
  const sp = await searchParams;
  const [customers, sites, gs] = await Promise.all([customerOptions(), siteOptions(), prisma.gstSetting.findFirst()]);
  const rate = gs?.defaultServiceRateId ? await prisma.gstRate.findUnique({ where: { id: gs.defaultServiceRateId } }) : null;
  return (
    <>
      <PageHeader title="Generate Customer Invoice" description="Weight-based: quantity × rate · Trip-based: trips × rate · Monthly: contract amount. Rates are taken from the version effective on each transaction date." crumbs={[{ href: "/invoices", label: "Invoices" }]} />
      <Card><CardContent>
        <InvoiceForm customers={customers} sites={sites} defaultGst={num(rate?.rate)} defaults={{ date: todayISO(), ...invoicePeriodDefaults(), customerId: str(sp, "customerId") }} />
      </CardContent></Card>
    </>
  );
}
