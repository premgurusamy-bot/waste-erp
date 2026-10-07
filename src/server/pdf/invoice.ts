import { prisma } from "@/lib/db";
import { formatDate, num, STATES } from "@/lib/utils";
import { rupeesInWords } from "@/lib/words";
import { pdfBuffer } from "../export";

export type InvoiceDoc = {
  title: string;
  number: string;
  date: Date;
  dueDate?: Date | null;
  period?: string | null;
  party: { label: string; name: string; address?: string | null; gstin?: string | null; stateCode?: string | null; contact?: string | null };
  placeOfSupply?: string | null;
  isInterState: boolean;
  lines: { description: string; code?: string | null; quantity: unknown; unit: string; rate: unknown; taxableValue: unknown; gstRate: unknown; cgst: unknown; sgst: unknown; igst: unknown; total: unknown }[];
  subtotal: unknown;
  cgst: unknown;
  sgst: unknown;
  igst: unknown;
  roundOff: unknown;
  total: unknown;
  amountReceived?: unknown;
  notes?: string | null;
  terms?: string | null;
  cancelled?: boolean;
  extra?: [string, string][];
};

const NAVY = "#1b365d";
const GREEN = "#039855";
const money = (v: unknown) => num(v as number).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v: unknown) => num(v as number).toLocaleString("en-IN", { maximumFractionDigits: 3 });

export async function renderInvoicePdf(inv: InvoiceDoc): Promise<Buffer> {
  const c = await prisma.company.findFirst();
  return pdfBuffer((doc) => {
    const L = 36;
    const W = doc.page.width - 72;
    doc.rect(L, 30, W, 3).fill(GREEN);
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(15).text(c?.name ?? "", L, 42, { width: W * 0.6 });
    doc.font("Helvetica").fontSize(8).fillColor("#475569");
    doc.text([c?.address, c?.city, c?.pincode].filter(Boolean).join(", "), { width: W * 0.6 });
    doc.text(`GSTIN: ${c?.gstin ?? "-"}   PAN: ${c?.pan ?? "-"}   State: ${c?.stateCode} - ${c?.stateName}`, { width: W * 0.6 });
    doc.text([c?.phone, c?.email].filter(Boolean).join("  ·  "), { width: W * 0.6 });
    doc.font("Helvetica-Bold").fontSize(16).fillColor(NAVY).text(inv.title, L + W * 0.55, 42, { width: W * 0.45, align: "right" });
    doc.font("Helvetica").fontSize(8).fillColor("#64748b").text("Original for Recipient", L + W * 0.55, 62, { width: W * 0.45, align: "right" });
    if (inv.cancelled) {
      doc.save().rotate(-30, { origin: [300, 400] }).font("Helvetica-Bold").fontSize(72).fillColor("#dc2626").opacity(0.15).text("CANCELLED", 80, 380).restore().opacity(1);
    }

    // Parties & document details
    let y = 112;
    doc.roundedRect(L, y, W, 92, 6).lineWidth(0.6).strokeColor("#cbd5e1").stroke();
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#64748b").text(inv.party.label.toUpperCase(), L + 10, y + 8);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#0f172a").text(inv.party.name, L + 10, y + 20, { width: W * 0.5 });
    doc.font("Helvetica").fontSize(8).fillColor("#334155");
    if (inv.party.address) doc.text(inv.party.address, { width: W * 0.5 });
    doc.text(`GSTIN: ${inv.party.gstin ?? "Unregistered"}`, { width: W * 0.5 });
    if (inv.party.stateCode) doc.text(`State: ${inv.party.stateCode} - ${STATES[inv.party.stateCode] ?? ""}`, { width: W * 0.5 });
    if (inv.party.contact) doc.text(inv.party.contact, { width: W * 0.5 });
    const details: [string, string][] = [
      ["Invoice No.", inv.number],
      ["Invoice Date", formatDate(inv.date)],
      ...(inv.dueDate ? [["Due Date", formatDate(inv.dueDate)] as [string, string]] : []),
      ...(inv.period ? [["Billing Period", inv.period] as [string, string]] : []),
      ["Place of Supply", inv.placeOfSupply ? `${inv.placeOfSupply} - ${STATES[inv.placeOfSupply] ?? ""}` : "-"],
      ...(inv.extra ?? []),
    ];
    let dy = y + 8;
    for (const [k, v] of details) {
      doc.font("Helvetica").fontSize(8).fillColor("#64748b").text(k, L + W * 0.56, dy, { width: 80 });
      doc.font("Helvetica-Bold").fillColor("#0f172a").text(v, L + W * 0.56 + 82, dy, { width: W * 0.44 - 92 });
      dy += 12;
    }

    // Lines
    y += 104;
    const cols = inv.isInterState
      ? [["#", 16, "l"], ["Description", 0, "l"], ["HSN/SAC", 44, "l"], ["Qty", 58, "r"], ["Rate", 46, "r"], ["Taxable", 62, "r"], ["IGST %", 34, "r"], ["IGST", 56, "r"], ["Total", 64, "r"]]
      : [["#", 16, "l"], ["Description", 0, "l"], ["HSN/SAC", 42, "l"], ["Qty", 56, "r"], ["Rate", 44, "r"], ["Taxable", 58, "r"], ["GST %", 30, "r"], ["CGST", 50, "r"], ["SGST", 50, "r"], ["Total", 62, "r"]];
    const fixed = cols.reduce((s, c) => s + (c[1] as number), 0);
    (cols[1] as any)[1] = W - fixed; // description takes the remaining width
    const drawRow = (cells: string[], header = false) => {
      doc.font(header ? "Helvetica-Bold" : "Helvetica").fontSize(7.5);
      const h = Math.max(...cells.map((t, i) => doc.heightOfString(t, { width: (cols[i][1] as number) - 6 }))) + 8;
      if (header) doc.rect(L, y, W, h).fill(NAVY);
      let x = L;
      cells.forEach((t, i) => {
        doc.fillColor(header ? "#fff" : "#0f172a").text(t, x + 3, y + 4, { width: (cols[i][1] as number) - 6, align: cols[i][2] === "r" ? "right" : "left" });
        x += cols[i][1] as number;
      });
      y += h;
      if (!header) doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.3).strokeColor("#e2e8f0").stroke();
    };
    drawRow(cols.map((c) => c[0] as string), true);
    inv.lines.forEach((l, i) => {
      if (y > doc.page.height - 200) {
        doc.addPage();
        y = 40;
        drawRow(cols.map((c) => c[0] as string), true);
      }
      const base = [String(i + 1), l.description, l.code ?? "", `${qty(l.quantity)} ${l.unit}`, money(l.rate), money(l.taxableValue), `${num(l.gstRate as number)}`];
      drawRow(inv.isInterState ? [...base, money(l.igst), money(l.total)] : [...base, money(l.cgst), money(l.sgst), money(l.total)]);
    });

    // Totals
    y += 10;
    const tx = L + W - 220;
    const totalRow = (k: string, v: string, bold = false) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 10 : 8.5).fillColor(bold ? NAVY : "#334155");
      doc.text(k, tx, y, { width: 110 });
      doc.text(v, tx + 110, y, { width: 110, align: "right" });
      y += bold ? 16 : 12;
    };
    const startY = y;
    totalRow("Taxable Value", money(inv.subtotal));
    if (inv.isInterState) totalRow("IGST", money(inv.igst));
    else {
      totalRow("CGST", money(inv.cgst));
      totalRow("SGST", money(inv.sgst));
    }
    if (num(inv.roundOff as number) !== 0) totalRow("Round Off", money(inv.roundOff));
    doc.moveTo(tx, y).lineTo(L + W, y).strokeColor("#94a3b8").stroke();
    y += 4;
    totalRow("Invoice Total (Rs.)", money(inv.total), true);
    if (inv.amountReceived !== undefined && num(inv.amountReceived as number) > 0) {
      totalRow("Received", money(inv.amountReceived));
      totalRow("Balance Due", money(num(inv.total as number) - num(inv.amountReceived as number)), true);
    }
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#64748b").text("Amount in words", L, startY, { width: W - 240 });
    doc.font("Helvetica").fontSize(8.5).fillColor("#0f172a").text(rupeesInWords(num(inv.total as number)), L, startY + 11, { width: W - 240 });
    if (c?.bankName) {
      doc.moveDown(0.8);
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#64748b").text("Bank details", L, doc.y, { width: W - 240 });
      doc.font("Helvetica").fontSize(8).fillColor("#0f172a").text(`${c.bankName} · A/c ${c.bankAccountNo ?? ""} · IFSC ${c.bankIfsc ?? ""}`, { width: W - 240 });
    }
    if (inv.terms) doc.font("Helvetica").fontSize(8).fillColor("#334155").text(inv.terms, L, doc.y + 4, { width: W - 240 });
    if (inv.notes) doc.font("Helvetica-Oblique").fontSize(8).fillColor("#475569").text(`Notes: ${inv.notes}`, L, doc.y + 4, { width: W - 240 });

    y = Math.max(y, doc.y) + 40;
    if (y > doc.page.height - 80) {
      doc.addPage();
      y = 60;
    }
    doc.font("Helvetica").fontSize(8).fillColor("#475569").text(`For ${c?.name ?? ""}`, L + W - 200, y, { width: 200, align: "right" });
    doc.moveTo(L + W - 160, y + 40).lineTo(L + W, y + 40).strokeColor("#94a3b8").stroke();
    doc.text("Authorised Signatory", L + W - 200, y + 44, { width: 200, align: "right" });
    if (c?.invoiceFooter) doc.fontSize(7.5).fillColor("#64748b").text(c.invoiceFooter, L, y + 64, { width: W, align: "center" });
    doc.fontSize(7).text("This is a computer-generated invoice.", L, doc.y + 2, { width: W, align: "center" });
  });
}
