import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCtx } from "@/server/auth/current-user";
import { assertCan } from "@/server/context";
import { toActionError } from "@/server/errors";
import { fileResponse, MIME } from "@/server/export";
import { renderInvoicePdf } from "@/server/pdf/invoice";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getCtx();
    assertCan(ctx, "sales.view");
    const { id } = await params;
    const s = await prisma.salesInvoice.findUnique({ where: { id }, include: { buyer: true, items: { include: { item: true } } } });
    if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const pdf = await renderInvoicePdf({
      title: "TAX INVOICE",
      number: s.number,
      date: s.date,
      dueDate: s.dueDate,
      party: { label: "Bill to (Buyer)", name: s.buyer.name, address: s.buyer.address, gstin: s.buyer.gstin, stateCode: s.buyer.stateCode, contact: [s.buyer.contactPerson, s.buyer.mobile].filter(Boolean).join(" · ") },
      placeOfSupply: s.placeOfSupply,
      isInterState: s.isInterState,
      lines: s.items.map((i) => ({ ...i, description: i.description ?? i.item.name, code: i.hsnCode })),
      subtotal: s.subtotal, cgst: s.cgst, sgst: s.sgst, igst: s.igst, roundOff: s.roundOff, total: s.total,
      amountReceived: s.amountReceived,
      notes: s.remarks,
      cancelled: s.status === "CANCELLED",
      extra: s.vehicleNumber ? [["Vehicle No.", s.vehicleNumber]] : [],
    });
    return fileResponse(pdf, `${s.number}.pdf`, MIME.pdf, !new URL(req.url).searchParams.get("download"));
  } catch (e) {
    return NextResponse.json({ error: toActionError(e).error }, { status: 400 });
  }
}
