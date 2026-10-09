import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { formatDateTime, formatQty } from "@/lib/utils";
import { getCtx } from "@/server/auth/current-user";
import { assertCan } from "@/server/context";
import { toActionError } from "@/server/errors";
import { drawLogo, fileResponse, MIME, pdfBrand, pdfBuffer } from "@/server/export";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getCtx();
    assertCan(ctx, "weighments.view");
    const { id } = await params;
    const w = await prisma.weighment.findUnique({ where: { id }, include: { vehicle: true, driver: true, customer: true, site: true, wasteType: true, location: true } });
    if (!w) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const out = await slipPdf(w);
    return fileResponse(out, `${w.number}.pdf`, MIME.pdf, true);
  } catch (e) {
    return NextResponse.json({ error: toActionError(e).error }, { status: 400 });
  }
}

async function slipPdf(w: any) {
  const company = await prisma.company.findFirst();
  const { accent, heading, logo } = await pdfBrand();
  return pdfBuffer((doc) => {
    const W = doc.page.width - 72;
    doc.rect(36, 30, W, 3).fill(accent);
    const off = drawLogo(doc, logo, 36, 40, 36);
    doc.fillColor(heading).font("Helvetica-Bold").fontSize(14).text(company?.name ?? "", 36 + off, 42, { width: W * 0.6 - off });
    doc.font("Helvetica").fontSize(8).fillColor("#475569").text([company?.address, company?.city].filter(Boolean).join(", "), { width: W * 0.6 - off });
    doc.font("Helvetica-Bold").fontSize(13).fillColor(heading).text("WEIGHBRIDGE SLIP", 36, 42, { width: W, align: "right" });
    doc.font("Helvetica").fontSize(9).fillColor("#475569").text(`${w.number}${w.slipNumber ? `  ·  Slip ${w.slipNumber}` : ""}`, 36, 60, { width: W, align: "right" });
    doc.y = 96;
    const row = (k: string, v: string) => {
      const y = doc.y;
      doc.font("Helvetica").fontSize(9).fillColor("#64748b").text(k, 36, y, { width: 140 });
      doc.font("Helvetica-Bold").fillColor("#0f172a").text(v || "-", 180, y, { width: W - 144 });
      doc.moveDown(0.5);
    };
    row("Vehicle", w.vehicle.number);
    row("Driver", w.driver?.name ?? "");
    row("Customer", w.customer.name);
    row("Site", w.site?.name ?? "");
    row("Waste Type", w.wasteType.name);
    row("Receiving Location", w.location.name);
    row("Gate In", formatDateTime(w.gateInAt));
    row("Gate Out", w.gateOutAt ? formatDateTime(w.gateOutAt) : "Pending");
    doc.moveDown(0.5);
    const boxY = doc.y;
    const bw = W / 3;
    const box = (i: number, label: string, val: string, hl = false) => {
      doc.rect(36 + i * bw, boxY, bw - 6, 60).lineWidth(hl ? 2 : 0.8).strokeColor(hl ? accent : "#cbd5e1").stroke();
      doc.font("Helvetica").fontSize(8).fillColor("#64748b").text(label, 44 + i * bw, boxY + 10, { width: bw - 22 });
      doc.font("Helvetica-Bold").fontSize(18).fillColor(hl ? accent : heading).text(val, 44 + i * bw, boxY + 26, { width: bw - 22 });
    };
    box(0, "GROSS WEIGHT (KG)", formatQty(w.grossWeight));
    box(1, "TARE WEIGHT (KG)", w.tareWeight ? formatQty(w.tareWeight) : "-");
    box(2, "NET WEIGHT (KG)", w.netWeight ? formatQty(w.netWeight) : "-", true);
    doc.y = boxY + 76;
    if (w.isNetOverridden) doc.font("Helvetica-Oblique").fontSize(8).fillColor("#b45309").text(`Net weight manually overridden by administrator. Reason: ${w.overrideReason}`, 36);
    doc.moveDown(3);
    const sy = doc.y;
    doc.font("Helvetica").fontSize(8).fillColor("#475569");
    doc.moveTo(36, sy).lineTo(200, sy).strokeColor("#94a3b8").stroke();
    doc.moveTo(W - 128, sy).lineTo(W + 36, sy).stroke();
    doc.text("Weighbridge Operator", 36, sy + 4);
    doc.text("Driver Signature", W - 128, sy + 4, { width: 164, align: "right" });
  }, { size: "A5", layout: "landscape", margin: 36 });
}
