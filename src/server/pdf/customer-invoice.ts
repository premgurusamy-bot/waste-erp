import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { renderInvoicePdf } from "./invoice";

export async function customerInvoicePdf(id: string) {
  const inv = await prisma.customerInvoice.findUnique({ where: { id }, include: { customer: true, site: true, items: true } });
  if (!inv) return null;
  const pdf = await renderInvoicePdf({
    title: "TAX INVOICE",
    number: inv.number,
    date: inv.date,
    dueDate: inv.dueDate,
    period: inv.periodFrom ? `${formatDate(inv.periodFrom)} to ${formatDate(inv.periodTo)}` : null,
    party: {
      label: "Bill to",
      name: inv.customer.name,
      address: [inv.customer.address, inv.customer.city, inv.customer.pincode].filter(Boolean).join(", "),
      gstin: inv.customer.gstin,
      stateCode: inv.customer.stateCode,
      contact: inv.site ? `Site: ${inv.site.name}` : [inv.customer.contactPerson, inv.customer.mobile].filter(Boolean).join(" · "),
    },
    placeOfSupply: inv.placeOfSupply,
    isInterState: inv.isInterState,
    lines: inv.items.map((i) => ({ ...i, code: i.sacCode })),
    subtotal: inv.subtotal, cgst: inv.cgst, sgst: inv.sgst, igst: inv.igst, roundOff: inv.roundOff, total: inv.total,
    amountReceived: inv.amountReceived,
    notes: inv.notes,
    terms: `Payment terms: ${inv.paymentTermsDays} days from invoice date.`,
    cancelled: inv.status === "CANCELLED",
    extra: [["Customer Code", inv.customer.code]],
  });
  return { inv, pdf };
}
