import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Kolkata";

type Numeric = number | string | { toString(): string } | null | undefined;

/** Convert Prisma Decimal / string / number to a JS number (null-safe). */
export function num(v: Numeric): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v.toString());
  return Number.isFinite(n) ? n : 0;
}

export function round(v: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round((v + Number.EPSILON) * f) / f;
}
export const round2 = (v: number) => round(v, 2);
export const round3 = (v: number) => round(v, 3);

const inr = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
const int = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export function formatMoney(v: Numeric, withSymbol = true): string {
  const s = inr.format(num(v));
  return withSymbol ? `₹${s}` : s;
}
export function formatQty(v: Numeric, unit?: string): string {
  return `${qty.format(num(v))}${unit ? ` ${unit}` : ""}`;
}
export function formatInt(v: Numeric): string {
  return int.format(num(v));
}
export function formatTonnes(kg: Numeric): string {
  return `${qty.format(round3(num(kg) / 1000))} T`;
}

/** Date-only values are stored as UTC midnight. */
export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  const iso = date.toISOString().slice(0, 10);
  const [y, m, day] = iso.split("-");
  return `${day}-${m}-${y}`;
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: APP_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function formatTime(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-IN", { timeZone: APP_TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: true }).format(date);
}

/** Today's calendar date in the app timezone, as "YYYY-MM-DD". */
export function todayISO(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Calendar date string -> Date at UTC midnight (how @db.Date columns are stored). */
export function dateOnly(iso: string | Date): Date {
  if (iso instanceof Date) return new Date(Date.UTC(iso.getUTCFullYear(), iso.getUTCMonth(), iso.getUTCDate()));
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
}

export function toISODate(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((dateOnly(to).getTime() - dateOnly(from).getTime()) / 86_400_000);
}

/** Start/end instants (UTC) covering a local calendar date range, for DateTime columns. */
export function localDayRange(fromISO: string, toISO: string): { gte: Date; lt: Date } {
  const offsetMin = tzOffsetMinutes(new Date(`${fromISO}T12:00:00Z`));
  const gte = new Date(new Date(`${fromISO}T00:00:00Z`).getTime() - offsetMin * 60_000);
  const lt = new Date(new Date(`${toISO}T00:00:00Z`).getTime() + 86_400_000 - offsetMin * 60_000);
  return { gte, lt };
}

function tzOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUTC - at.getTime()) / 60_000);
}

/** Local date-time string "YYYY-MM-DDTHH:mm" (from datetime-local inputs) -> Date. */
export function localDateTime(value: string): Date {
  const [d, t = "00:00"] = value.split("T");
  const offsetMin = tzOffsetMinutes(new Date(`${d}T12:00:00Z`));
  return new Date(new Date(`${d}T${t.slice(0, 5)}:00Z`).getTime() - offsetMin * 60_000);
}

/** Date -> "YYYY-MM-DDTHH:mm" in app timezone (for datetime-local inputs). */
export function toLocalInput(d: Date | null | undefined): string {
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Recursively convert Prisma Decimals/Dates into plain JSON-safe values for client components. */
export function serialize<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

export const STATES: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
  "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
  "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya",
  "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "26": "Dadra & Nagar Haveli and Daman & Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa",
  "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman & Nicobar Islands",
  "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
};
