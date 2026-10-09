/**
 * Canonical text form of every cell value. The checksum is computed over this form,
 * both when the backup is written (from the database) and when it is read back (from Excel),
 * so a single changed cell anywhere in the data makes verification fail.
 */
import { createHash } from "node:crypto";
import type { ColType, SheetDef } from "./sheets.js";
import { isoDate, num, round2 } from "../../shared/calc.js";

export class CellError extends Error {}

const DAY = 86_400_000;
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/** Unwrap ExcelJS cell value objects (rich text, hyperlinks, formulas) into a primitive. */
export function cellPrimitive(v: any): any {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((t: any) => t.text).join("");
    if ("result" in v) return cellPrimitive(v.result);
    if ("text" in v) return cellPrimitive(v.text);
    if ("error" in v) return null;
    return String(v);
  }
  return v;
}

function parseNumber(v: any): number {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new CellError("is not a valid number");
    return v;
  }
  let t = String(v).trim().replace(/^(rs\.?|inr|₹)\s*/i, "").replace(/\s*(\/-|rs\.?|inr)$/i, "").replace(/[₹,\s]/g, "");
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); } // accounting style (1,000)
  if (/^\.\d/.test(t)) t = `0${t}`;
  if (!/^-?\d+(\.\d+)?$/.test(t)) throw new CellError(`"${v}" is not a valid number`);
  return neg ? -Number(t) : Number(t);
}

function parseDate(v: any): string {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) throw new CellError("is not a valid date");
    return isoDate(new Date(Math.round(v.getTime() / DAY) * DAY));
  }
  if (typeof v === "number") return isoDate(new Date(EXCEL_EPOCH + Math.round(v) * DAY));
  const t = String(v).trim();
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const year = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s));
  let y: number, mo: number, da: number;
  let mm = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (mm) [y, mo, da] = [Number(mm[1]), Number(mm[2]), Number(mm[3])];
  else if ((mm = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:\s.*)?$/))) [da, mo, y] = [Number(mm[1]), Number(mm[2]), year(mm[3])];
  else if ((mm = t.match(/^(\d{1,2})[-/.\s]+([A-Za-z]{3,9})[-/.,\s]+(\d{4}|\d{2})$/)) && MONTHS.includes(mm[2].slice(0, 3).toLowerCase())) [da, mo, y] = [Number(mm[1]), MONTHS.indexOf(mm[2].slice(0, 3).toLowerCase()) + 1, year(mm[3])];
  else if ((mm = t.match(/^([A-Za-z]{3,9})[-/.\s]+(\d{1,2}),?[-/.\s]+(\d{4})$/)) && MONTHS.includes(mm[1].slice(0, 3).toLowerCase())) [da, mo, y] = [Number(mm[2]), MONTHS.indexOf(mm[1].slice(0, 3).toLowerCase()) + 1, Number(mm[3])];
  else if (/^\d{5}$/.test(t)) return isoDate(new Date(EXCEL_EPOCH + Number(t) * DAY));
  else throw new CellError(`"${t}" is not a valid date (use DD-MM-YYYY)`);
  const dt = new Date(Date.UTC(y, mo - 1, da));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== da) throw new CellError(`"${t}" is not a real calendar date`);
  return isoDate(dt);
}

export function canon(type: ColType, raw: any): string {
  const v = cellPrimitive(raw);
  if (v === null || v === undefined || v === "") return "";
  switch (type) {
    case "id":
    case "string":
      if (v instanceof Date) return v.toISOString();
      return String(v);
    case "int": {
      const n = parseNumber(v);
      if (!Number.isInteger(n)) throw new CellError(`"${v}" must be a whole number`);
      return String(n);
    }
    case "money":
    case "pct":
      return round2(parseNumber(v)).toFixed(2);
    case "qty":
      return (Math.round(parseNumber(v) * 1000) / 1000).toFixed(3);
    case "km":
      return (Math.round(parseNumber(v) * 10) / 10).toFixed(1);
    case "date":
      return parseDate(v);
    case "datetime": {
      const d = v instanceof Date ? v : new Date(String(v));
      if (isNaN(d.getTime())) throw new CellError(`"${v}" is not a valid date-time`);
      return d.toISOString();
    }
    case "bool": {
      const t = String(v).trim().toUpperCase();
      if (["TRUE", "YES", "1"].includes(t)) return "TRUE";
      if (["FALSE", "NO", "0"].includes(t)) return "FALSE";
      throw new CellError(`"${v}" must be TRUE or FALSE`);
    }
    case "json": {
      if (typeof v === "object") return JSON.stringify(v);
      try {
        return JSON.stringify(JSON.parse(String(v)));
      } catch {
        throw new CellError("is not valid JSON");
      }
    }
  }
}

/** Value to put in the Excel cell for a canonical string (numbers as numbers, dates as real dates). */
export function excelValue(type: ColType, c: string): any {
  if (c === "") return null;
  switch (type) {
    case "int":
    case "money":
    case "pct":
    case "qty":
    case "km":
      return Number(c);
    case "date":
      return new Date(`${c}T00:00:00.000Z`);
    default:
      return c;
  }
}

/** Database value for a canonical string (what Prisma expects on create/update). */
export function dbValue(type: ColType, c: string): any {
  if (c === "") return null;
  switch (type) {
    case "int":
      return Number(c);
    case "money":
    case "pct":
    case "qty":
    case "km":
      return c; // Prisma Decimal accepts the exact decimal string
    case "date":
      return new Date(`${c}T00:00:00.000Z`);
    case "datetime":
      return new Date(c);
    case "bool":
      return c === "TRUE";
    case "json":
      return JSON.parse(c);
    default:
      return c;
  }
}

export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export function sheetHash(def: SheetDef, rows: string[][]): string {
  const h = createHash("sha256");
  h.update(`${def.name}\n${def.columns.map((c) => c.key).join("|")}\n`, "utf8");
  for (const r of rows) h.update(r.join("\u001f") + "\n", "utf8");
  return h.digest("hex");
}

/** Overall checksum: covers every sheet hash, every record count and every financial total. */
export function overallChecksum(parts: { name: string; count: number; hash: string }[], financials: Record<string, number>): string {
  const lines = parts.map((p) => `${p.name}|${p.count}|${p.hash}`);
  for (const [k, v] of Object.entries(financials)) lines.push(`${k}|${round2(num(v)).toFixed(2)}`);
  return sha256(lines.join("\n"));
}
