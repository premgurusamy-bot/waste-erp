/**
 * Business calculations shared by the server, the web UI and the tests.
 * Every formula is written out in plain arithmetic so it can be shown to the user.
 */

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const num = (v: unknown): number => {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v));
  return Number.isFinite(n) ? n : 0;
};

export type TripMoney = {
  customerFreight: unknown;
  transporterHire: unknown;
  loadingCharges: unknown;
  unloadingCharges: unknown;
  diesel: unknown;
  toll: unknown;
  rto: unknown;
  driverBata: unknown;
  otherExpense: unknown;
  advance?: unknown;
  distanceKm?: unknown;
};

export type TripProfit = {
  revenue: number;
  hire: number;
  loading: number;
  unloading: number;
  diesel: number;
  toll: number;
  rto: number;
  driverBata: number;
  otherExpense: number;
  linkedExpenses: number;
  totalCost: number;
  profit: number;
  profitPct: number;
  distanceKm: number;
  revenuePerKm: number | null;
  costPerKm: number | null;
  profitPerKm: number | null;
  advance: number;
  hireBalance: number;
  formula: string;
};

/**
 * NET PROFIT = Revenue - (Hire + Loading + Unloading + Diesel + Toll + RTO + Driver Bata + Other + Linked expense entries)
 * Profit % = Profit / Revenue x 100
 */
export function tripProfit(t: TripMoney, linkedExpenses = 0): TripProfit {
  const revenue = num(t.customerFreight);
  const hire = num(t.transporterHire);
  const loading = num(t.loadingCharges);
  const unloading = num(t.unloadingCharges);
  const diesel = num(t.diesel);
  const toll = num(t.toll);
  const rto = num(t.rto);
  const driverBata = num(t.driverBata);
  const otherExpense = num(t.otherExpense);
  const linked = num(linkedExpenses);
  const totalCost = round2(hire + loading + unloading + diesel + toll + rto + driverBata + otherExpense + linked);
  const profit = round2(revenue - totalCost);
  const km = num(t.distanceKm);
  const perKm = (v: number) => (km > 0 ? round2(v / km) : null);
  const advance = num(t.advance);
  return {
    revenue, hire, loading, unloading, diesel, toll, rto, driverBata, otherExpense,
    linkedExpenses: linked,
    totalCost,
    profit,
    profitPct: revenue > 0 ? round2((profit / revenue) * 100) : 0,
    distanceKm: km,
    revenuePerKm: perKm(revenue),
    costPerKm: perKm(totalCost),
    profitPerKm: perKm(profit),
    advance,
    hireBalance: round2(hire - advance),
    formula: `${revenue} - (${hire} + ${loading} + ${unloading} + ${diesel} + ${toll} + ${rto} + ${driverBata} + ${otherExpense}${linked ? ` + ${linked}` : ""}) = ${profit}`,
  };
}

// ---------------------------------------------------------------- dates (calendar dates are handled as YYYY-MM-DD strings, UTC)

const DAY = 86_400_000;
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const parseIso = (s: string) => new Date(`${s}T00:00:00.000Z`);
export const addDays = (s: string, n: number) => isoDate(new Date(parseIso(s).getTime() + n * DAY));
export const daysBetween = (from: string, to: string) => Math.round((parseIso(to).getTime() - parseIso(from).getTime()) / DAY);

/** Today's calendar date in India (the business runs on IST). */
export function todayIst(now = new Date()): string {
  return isoDate(new Date(now.getTime() + 330 * 60_000));
}

/** Indian financial year: 1 April - 31 March. Returns e.g. { label: "2026-27", start: "2026-04-01", end: "2027-03-31" }. */
export function financialYear(date: string) {
  const [y, m] = date.split("-").map(Number);
  const startYear = m >= 4 ? y : y - 1;
  return {
    label: `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`,
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-03-31`,
  };
}

export type PeriodType = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

/** Period containing `date`. Weeks run Monday-Sunday. Years are Indian financial years. */
export function periodRange(period: PeriodType, date: string): { start: string; end: string } {
  if (period === "DAILY") return { start: date, end: date };
  if (period === "WEEKLY") {
    const dow = (parseIso(date).getUTCDay() + 6) % 7; // Monday = 0
    const start = addDays(date, -dow);
    return { start, end: addDays(start, 6) };
  }
  if (period === "MONTHLY") {
    const [y, m] = date.split("-").map(Number);
    const start = `${y}-${String(m).padStart(2, "0")}-01`;
    const end = isoDate(new Date(Date.UTC(y, m, 0)));
    return { start, end };
  }
  const fy = financialYear(date);
  return { start: fy.start, end: fy.end };
}

// ---------------------------------------------------------------- target meter

export type TargetStatus = "TARGET ACHIEVED" | "ON TRACK" | "AT RISK" | "BEHIND TARGET";

export type TargetMeter = {
  target: number;
  achieved: number;
  remaining: number;
  achievementPct: number;
  totalDays: number;
  daysElapsed: number;
  daysRemaining: number;
  requiredDaily: number;
  currentDailyAverage: number;
  projected: number;
  projectedPct: number;
  status: TargetStatus;
  formulas: Record<string, string>;
};

/**
 * Transparent target maths. `today` counts as an elapsed day.
 *  Remaining          = Target - Achieved
 *  Achievement %      = Achieved / Target x 100
 *  Days remaining     = days after today up to the period end
 *  Required daily     = Remaining / Days remaining
 *  Current daily avg  = Achieved / Days elapsed
 *  Projected          = Current daily avg x Total days
 * Status:
 *  TARGET ACHIEVED  Achieved >= Target
 *  ON TRACK         Projected >= Target
 *  AT RISK          Projected >= 85% of Target
 *  BEHIND TARGET    Projected <  85% of Target
 */
export function targetMeter(input: { target: number; achieved: number; start: string; end: string; today: string }): TargetMeter {
  const target = round2(num(input.target));
  const achieved = round2(num(input.achieved));
  const totalDays = daysBetween(input.start, input.end) + 1;
  const clampedToday = input.today < input.start ? addDays(input.start, -1) : input.today > input.end ? input.end : input.today;
  const daysElapsed = Math.max(0, daysBetween(input.start, clampedToday) + 1);
  const daysRemaining = totalDays - daysElapsed;
  const remaining = round2(Math.max(0, target - achieved));
  const currentDailyAverage = daysElapsed > 0 ? round2(achieved / daysElapsed) : 0;
  const requiredDaily = daysRemaining > 0 ? round2(remaining / daysRemaining) : remaining;
  const projected = daysElapsed > 0 ? round2((achieved / daysElapsed) * totalDays) : 0;
  const achievementPct = target > 0 ? round2((achieved / target) * 100) : 0;
  const projectedPct = target > 0 ? round2((projected / target) * 100) : 0;
  let status: TargetStatus;
  if (target > 0 && achieved >= target) status = "TARGET ACHIEVED";
  else if (projected >= target) status = "ON TRACK";
  else if (projected >= target * 0.85) status = "AT RISK";
  else status = "BEHIND TARGET";
  return {
    target, achieved, remaining, achievementPct, totalDays, daysElapsed, daysRemaining,
    requiredDaily, currentDailyAverage, projected, projectedPct, status,
    formulas: {
      remaining: `${target} - ${achieved} = ${remaining}`,
      achievementPct: `${achieved} / ${target} x 100 = ${achievementPct}%`,
      requiredDaily: `${remaining} / ${daysRemaining} days = ${requiredDaily}`,
      currentDailyAverage: `${achieved} / ${daysElapsed} days = ${currentDailyAverage}`,
      projected: `${currentDailyAverage} x ${totalDays} days = ${projected}`,
      status: "ACHIEVED if achieved >= target; ON TRACK if projected >= target; AT RISK if projected >= 85% of target; otherwise BEHIND TARGET",
    },
  };
}

// ---------------------------------------------------------------- GST

export type GstType = "NONE" | "CGST_SGST" | "IGST" | "RCM";

/**
 * GST is never assumed: the invoice says which treatment applies.
 *  NONE       no GST (exempt / unregistered / not applicable)
 *  CGST_SGST  intra-state: rate split equally
 *  IGST       inter-state: full rate
 *  RCM        reverse charge: tax is payable by the recipient, so nothing is added to the invoice total
 */
export function computeGst(taxable: number, gstType: GstType, rate: number) {
  const t = round2(num(taxable));
  const r = num(rate);
  let cgst = 0, sgst = 0, igst = 0;
  if (gstType === "CGST_SGST") { cgst = round2((t * r) / 200); sgst = round2((t * r) / 200); }
  if (gstType === "IGST") igst = round2((t * r) / 100);
  const gross = round2(t + cgst + sgst + igst);
  const total = Math.round(gross);
  return { taxable: t, cgst, sgst, igst, roundOff: round2(total - gross), total };
}

// ---------------------------------------------------------------- ageing

export const AGEING_BUCKETS = ["0-30", "31-60", "61-90", "90+"] as const;
export function ageingBucket(days: number): (typeof AGEING_BUCKETS)[number] {
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

// ---------------------------------------------------------------- backup reminders / expiry

export function backupAgeLevel(hours: number | null): "OK" | "WARNING" | "URGENT" | "CRITICAL" {
  if (hours === null) return "CRITICAL";
  if (hours >= 24 * 7) return "CRITICAL";
  if (hours >= 48) return "URGENT";
  if (hours >= 24) return "WARNING";
  return "OK";
}

export function expiryLevel(daysLeft: number): "EXPIRED" | "7 DAYS" | "15 DAYS" | "30 DAYS" | "60 DAYS" | null {
  if (daysLeft < 0) return "EXPIRED";
  if (daysLeft <= 7) return "7 DAYS";
  if (daysLeft <= 15) return "15 DAYS";
  if (daysLeft <= 30) return "30 DAYS";
  if (daysLeft <= 60) return "60 DAYS";
  return null;
}

// ---------------------------------------------------------------- formatting

export function inr(n: unknown, decimals = 0): string {
  const v = num(n);
  return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function displayDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}-${m}-${y}`;
}

export const TRIP_STATUSES = ["BOOKED", "ALLOCATED", "LOADED", "IN TRANSIT", "DELIVERED", "POD RECEIVED", "BILLED", "SETTLED", "CLOSED", "CANCELLED"] as const;
export const EXPENSE_CATEGORIES = ["DIESEL", "TOLL", "RTO", "DRIVER BATA", "LOADING", "UNLOADING", "REPAIR", "MAINTENANCE", "OFFICE", "SALARY", "OTHER"] as const;
export const ROLES = ["SUPER_ADMIN", "ADMIN", "TRANSPORT_MANAGER", "OPERATIONS", "ACCOUNTS", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];
export const APP_VERSION = "1.0.0";
export const SCHEMA_VERSION = "1";
