import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { formatDate, todayISO, toISODate } from "@/lib/utils";
import { getCtx } from "@/server/auth/current-user";
import { assertCan } from "@/server/context";
import { toActionError } from "@/server/errors";
import { fileResponse, MIME, toPdf, toXlsx } from "@/server/export";
import { customerStatement } from "@/server/statement";

export async function GET(req: Request) {
  try {
    const ctx = await getCtx();
    assertCan(ctx, "customers.view");
    const u = new URL(req.url);
    const customerId = u.searchParams.get("customerId") ?? "";
    const to = u.searchParams.get("to") || todayISO();
    const from = u.searchParams.get("from") || `${to.slice(0, 4)}-01-01`;
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    const st = await customerStatement(customerId, from, to);
    const table = {
      title: `Statement of Account - ${customer.name}`,
      subtitle: `${customer.code} · ${formatDate(from)} to ${formatDate(to)} · Opening ${st.opening.toFixed(2)} · Closing ${st.closing.toFixed(2)}`,
      columns: [
        { key: "date", label: "Date", type: "date" as const },
        { key: "type", label: "Type" },
        { key: "number", label: "Number" },
        { key: "description", label: "Details" },
        { key: "debit", label: "Debit", type: "money" as const, total: true },
        { key: "credit", label: "Credit", type: "money" as const, total: true },
        { key: "balance", label: "Balance", type: "money" as const },
      ],
      rows: [
        { date: from, type: "Opening", number: "", description: "Opening balance", debit: null, credit: null, balance: st.opening },
        ...st.lines.map((l) => ({ ...l, date: toISODate(l.date) })),
      ],
      totals: { debit: st.totalDebit, credit: st.totalCredit, balance: st.closing },
    };
    const name = `Statement_${customer.code}_${from}_${to}`;
    if (u.searchParams.get("format") === "xlsx") return fileResponse(await toXlsx(table), `${name}.xlsx`, MIME.xlsx);
    return fileResponse(await toPdf(table), `${name}.pdf`, MIME.pdf, true);
  } catch (e) {
    return NextResponse.json({ error: toActionError(e).error }, { status: 400 });
  }
}
