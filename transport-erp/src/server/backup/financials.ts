import { num, round2, tripProfit } from "../../shared/calc.js";

export type FinancialTotals = {
  totalRevenue: number;
  totalTripCost: number;
  totalExpenses: number;
  totalProfit: number;
  totalReceivable: number;
  totalPayable: number;
  totalTrips: number;
  totalInvoiceValue: number;
  totalReceipts: number;
  totalTransporterPayments: number;
};

export const FINANCIAL_LABELS: Record<keyof FinancialTotals, string> = {
  totalRevenue: "Total Revenue",
  totalTripCost: "Total Trip Cost",
  totalExpenses: "Total Expense Entries",
  totalProfit: "Total Profit",
  totalReceivable: "Total Receivable",
  totalPayable: "Total Payable",
  totalTrips: "Total Trips",
  totalInvoiceValue: "Total Invoice Value",
  totalReceipts: "Total Customer Payments",
  totalTransporterPayments: "Total Transporter Payments",
};

/**
 * The same function computes totals from database rows and from rows read out of an Excel backup,
 * so "before backup" and "after restore" are compared with identical arithmetic.
 *  Revenue     = customer freight of trips that are not cancelled
 *  Trip cost   = hire + loading + unloading + diesel + toll + RTO + driver bata + other (trips not cancelled)
 *  Expenses    = active expense entries
 *  Profit      = Revenue - Trip cost - Expenses
 *  Receivable  = customer opening balances + active invoice totals - active receipts (amount + TDS)
 *  Payable     = transporter opening balances + (hire - advance - deductions) of open trips - active transporter payments
 *                + unpaid expense entries
 */
export function computeFinancials(d: {
  customers: any[]; transporters: any[]; trips: any[]; expenses: any[]; invoices: any[]; receipts: any[]; settlements: any[]; payments: any[];
}): FinancialTotals {
  let revenue = 0, tripCost = 0, trips = 0, hireOpen = 0;
  const deductions = new Map<string, number>();
  for (const s of d.settlements) if (s.status !== "CANCELLED") deductions.set(s.tripId, num(s.deductions));
  for (const t of d.trips) {
    if (t.status === "CANCELLED") continue;
    trips++;
    const p = tripProfit(t);
    revenue += p.revenue;
    tripCost += p.totalCost;
    if (t.transporterId) hireOpen += p.hire - p.advance - (deductions.get(t.id) ?? 0);
  }
  let expenses = 0, unpaid = 0;
  for (const e of d.expenses) {
    if (e.status === "CANCELLED") continue;
    expenses += num(e.amount);
    if (e.paymentStatus === "UNPAID") unpaid += num(e.amount);
  }
  let invoiceValue = 0;
  for (const i of d.invoices) if (i.status !== "CANCELLED") invoiceValue += num(i.total);
  let receipts = 0;
  for (const r of d.receipts) if (r.status !== "CANCELLED") receipts += num(r.amount) + num(r.tdsAmount);
  let tpay = 0;
  for (const p of d.payments) if (p.status !== "CANCELLED") tpay += num(p.amount);
  const custOpening = d.customers.reduce((a, c) => a + num(c.openingBalance), 0);
  const trOpening = d.transporters.reduce((a, c) => a + num(c.openingBalance), 0);
  return {
    totalRevenue: round2(revenue),
    totalTripCost: round2(tripCost),
    totalExpenses: round2(expenses),
    totalProfit: round2(revenue - tripCost - expenses),
    totalReceivable: round2(custOpening + invoiceValue - receipts),
    totalPayable: round2(trOpening + hireOpen - tpay + unpaid),
    totalTrips: trips,
    totalInvoiceValue: round2(invoiceValue),
    totalReceipts: round2(receipts),
    totalTransporterPayments: round2(tpay),
  };
}
