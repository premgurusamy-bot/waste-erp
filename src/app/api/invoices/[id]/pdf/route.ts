import { NextResponse } from "next/server";
import { getCtx } from "@/server/auth/current-user";
import { assertCan } from "@/server/context";
import { toActionError } from "@/server/errors";
import { fileResponse, MIME } from "@/server/export";
import { customerInvoicePdf } from "@/server/pdf/customer-invoice";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getCtx();
    assertCan(ctx, "billing.view");
    const { id } = await params;
    const res = await customerInvoicePdf(id);
    if (!res) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return fileResponse(res.pdf, `${res.inv.number}.pdf`, MIME.pdf, !new URL(req.url).searchParams.get("download"));
  } catch (e) {
    return NextResponse.json({ error: toActionError(e).error }, { status: 400 });
  }
}
