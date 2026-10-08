export { inr, displayDate, num, todayIst, addDays, periodRange } from "../shared/calc";

export function money(n: unknown, decimals = 0) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "₹0";
  const s = Math.abs(v).toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${v < 0 ? "-" : ""}₹${s}`;
}

export function dateTime(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
