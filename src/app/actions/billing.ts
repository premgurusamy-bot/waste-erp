"use server";

import { prisma } from "@/lib/db";
import { act } from "@/server/action";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/context";
import { AppError } from "@/server/errors";
import { emailConfigured, sendMail } from "@/server/mail";
import { customerInvoicePdf } from "@/server/pdf/customer-invoice";
import { cancelCustomerInvoice, createCustomerInvoice, getBillingPreview } from "@/server/services/billing";

export async function previewBillingAction(q: { customerId: string; siteId?: string; periodFrom: string; periodTo: string }) {
  return act((ctx) => getBillingPreview(ctx, q));
}
export async function createInvoiceAction(values: Record<string, unknown>) {
  return act((ctx) => createCustomerInvoice(ctx, values), ["/invoices", "/outstanding", "/dashboard"]);
}
export async function cancelInvoiceAction(id: string, reason: string) {
  return act((ctx) => cancelCustomerInvoice(ctx, id, reason), ["/invoices", "/outstanding"]);
}
export async function emailInvoiceAction(id: string, to: string) {
  return act(async (ctx) => {
    assertCan(ctx, "billing.manage");
    if (!emailConfigured()) throw new AppError("Email is not configured. Ask the administrator to set the SMTP settings.");
    if (!/^\S+@\S+\.\S+$/.test(to)) throw new AppError("Enter a valid email address.");
    const res = await customerInvoicePdf(id);
    if (!res) throw new AppError("Invoice not found.");
    const company = await prisma.company.findFirst();
    await sendMail({
      to,
      subject: `Invoice ${res.inv.number} from ${company?.name ?? ""}`,
      text: `Dear ${res.inv.customer.name},\n\nPlease find attached invoice ${res.inv.number} for Rs. ${res.inv.total}.\n\nRegards,\n${company?.name ?? ""}`,
      attachments: [{ filename: `${res.inv.number}.pdf`, content: res.pdf }],
    });
    await prisma.$transaction(async (tx) => {
      await tx.customerInvoice.update({ where: { id }, data: { emailedAt: new Date() } });
      await audit(tx, ctx, { action: "EMAIL", module: "billing", recordId: id, recordLabel: res.inv.number, newValues: { to } });
    });
    return { sent: true };
  }, ["/invoices"]);
}
