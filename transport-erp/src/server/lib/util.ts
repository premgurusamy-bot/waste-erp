import { Prisma } from "@prisma/client";
import { isoDate } from "../../shared/calc.js";

/** Convert Prisma values (Decimal, Date) into plain JSON: money as numbers, @db.Date as YYYY-MM-DD. */
export function plain<T>(v: T): any {
  if (v === null || v === undefined) return v;
  if (v instanceof Prisma.Decimal) return v.toNumber();
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
  }
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === "object") {
    const out: any = {};
    for (const [k, val] of Object.entries(v as any)) out[k] = plain(val);
    return out;
  }
  return v;
}

export const toDate = (s: string | null | undefined) => (s ? new Date(`${s.slice(0, 10)}T00:00:00.000Z`) : null);
export const dateStr = (d: Date | null | undefined) => (d ? isoDate(d) : null);

export function pageParams(q: any) {
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 25));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}
