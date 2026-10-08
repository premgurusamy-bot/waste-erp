import ExcelJS from "exceljs";
import { SHEETS } from "./sheets.js";

/** Blank workbook for entering data in Excel and loading it with IMPORT ONLY. */
export async function writeImportTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const help = wb.addWorksheet("Instructions");
  help.getColumn(1).width = 120;
  [
    "G ROAD LINES ERP - IMPORT TEMPLATE",
    "",
    "1. Fill in the sheets you need (for example only 02_Customers). Leave the other sheets empty or delete them.",
    "2. ID and Code columns may be left empty for NEW records - the ERP creates them. To update an existing record, keep its ID.",
    "3. Dates: DD-MM-YYYY. Amounts: plain numbers (commas allowed). Status: ACTIVE or INACTIVE.",
    "4. Linked IDs (e.g. Customer ID on a trip) must be the ERP ID of an existing record, or of a record in this file.",
    "5. Grey columns are calculated by the ERP and are ignored.",
    "6. In the ERP: Backup & Restore -> IMPORT DATA -> choose this file -> check the preview -> confirm.",
    "   A safety backup of the current data is made automatically before anything is imported.",
  ].forEach((l, i) => { const r = help.addRow([l]); if (i === 0) r.font = { bold: true, size: 14 }; });
  for (const def of SHEETS) {
    if (["auditLogs", "notifications"].includes(def.key)) continue;
    const ws = wb.addWorksheet(def.name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = def.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? Math.max(12, c.header.length + 2) }));
    def.columns.forEach((c, i) => {
      const cell = ws.getRow(1).getCell(i + 1);
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c.derived ? "FF7F8C8D" : c.required ? "FFB03A2E" : "FF1F3A5F" } };
      if (c.enum) cell.note = `Allowed: ${c.enum.join(", ")}`;
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
