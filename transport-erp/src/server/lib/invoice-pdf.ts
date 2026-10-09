import PDFDocument from "pdfkit";
import { displayDate, num } from "../../shared/calc.js";

const m = (n: any) => Number(num(n)).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function words(n: number): string {
  const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number) => (x < 20 ? a[x] : `${b[Math.floor(x / 10)]}${x % 10 ? " " + a[x % 10] : ""}`);
  const three = (x: number) => (x >= 100 ? `${a[Math.floor(x / 100)]} Hundred${x % 100 ? " " + two(x % 100) : ""}` : two(x));
  if (n === 0) return "Zero";
  let out = "";
  const crore = Math.floor(n / 1e7), lakh = Math.floor((n % 1e7) / 1e5), th = Math.floor((n % 1e5) / 1000), rest = n % 1000;
  if (crore) out += `${three(crore)} Crore `;
  if (lakh) out += `${two(lakh)} Lakh `;
  if (th) out += `${two(th)} Thousand `;
  if (rest) out += three(rest);
  return out.trim();
}

export function invoicePdf(inv: any, terms: string): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 36 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    const c = inv.company ?? {};
    doc.font("Helvetica-Bold").fontSize(16).text(c.name ?? "G Road Lines", { align: "center" });
    doc.font("Helvetica").fontSize(8.5).text([c.address, c.city, c.state, c.pincode].filter(Boolean).join(", "), { align: "center" });
    doc.text([c.phone && `Ph: ${c.phone}`, c.email, c.gstin && `GSTIN: ${c.gstin}`, c.pan && `PAN: ${c.pan}`].filter(Boolean).join("  ·  "), { align: "center" });
    doc.moveDown(0.5).font("Helvetica-Bold").fontSize(12).text(inv.status === "CANCELLED" ? "TAX INVOICE (CANCELLED)" : "TAX INVOICE", { align: "center" });
    doc.moveDown(0.5);
    const top = doc.y;
    doc.font("Helvetica-Bold").fontSize(9).text("Bill To:", 36, top);
    doc.font("Helvetica").text(inv.customer.name).text(inv.customer.company ?? "").text(inv.customer.address ?? "").text(inv.customer.gstin ? `GSTIN: ${inv.customer.gstin}` : "");
    doc.font("Helvetica").text(`Invoice No: ${inv.invoiceNumber}`, 360, top).text(`Invoice Date: ${displayDate(inv.invoiceDate)}`, 360).text(`Due Date: ${displayDate(inv.dueDate)}`, 360).text(`Place of Supply: ${inv.placeOfSupply ?? ""}`, 360);
    doc.y = Math.max(doc.y, top + 70);
    const cols = [{ h: "#", w: 24 }, { h: "Description", w: 330 }, { h: "SAC", w: 50 }, { h: "Amount (Rs.)", w: 119 }];
    let y = doc.y + 6;
    const row = (vals: string[], bold = false) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5);
      const h = Math.max(...vals.map((v, i) => doc.heightOfString(v, { width: cols[i].w - 6 }))) + 6;
      if (y + h > doc.page.height - 120) { doc.addPage(); y = 36; }
      let x = 36;
      vals.forEach((v, i) => { doc.text(v, x + 3, y + 3, { width: cols[i].w - 6, align: i === 3 ? "right" : "left" }); x += cols[i].w; });
      doc.rect(36, y, 523, h).strokeColor("#999").lineWidth(0.5).stroke();
      y += h;
    };
    row(cols.map((c) => c.h), true);
    for (const it of inv.items) row([String(it.lineNo), it.description, it.sacCode ?? "", m(it.amount)]);
    const tot = (label: string, v: any, bold = false) => row(["", label, "", m(v)], bold);
    tot("Taxable value", inv.taxableValue);
    if (inv.gstType === "CGST_SGST") { tot(`CGST @ ${num(inv.gstRate) / 2}%`, inv.cgst); tot(`SGST @ ${num(inv.gstRate) / 2}%`, inv.sgst); }
    if (inv.gstType === "IGST") tot(`IGST @ ${num(inv.gstRate)}%`, inv.igst);
    if (num(inv.roundOff)) tot("Round off", inv.roundOff);
    tot("INVOICE TOTAL", inv.total, true);
    doc.y = y + 8;
    doc.x = 36;
    doc.font("Helvetica").fontSize(8.5).text(`Amount in words: Rupees ${words(Math.round(num(inv.total)))} Only`, 36);
    if (inv.gstType === "RCM") doc.text("GST payable by the recipient under reverse charge.");
    if (inv.gstType === "NONE") doc.text("No GST charged on this invoice.");
    doc.text(`Received: Rs. ${m(inv.received)}    Balance: Rs. ${m(inv.balance)}`);
    if (c.bankName) doc.moveDown(0.5).text(`Bank: ${c.bankName}  A/c: ${c.bankAccount ?? ""}  IFSC: ${c.bankIfsc ?? ""}`);
    if (inv.notes) doc.moveDown(0.5).text(`Notes: ${inv.notes}`);
    doc.moveDown(0.5).fontSize(7.5).fillColor("#555").text(terms).fillColor("#000");
    doc.moveDown(2).fontSize(9).text(`For ${c.name ?? ""}`, { align: "right" }).moveDown(2).text("Authorised Signatory", { align: "right" });
    doc.end();
  });
}
