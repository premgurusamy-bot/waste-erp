import { ArrowRight, Building2, CalendarRange, Factory, IndianRupee, Recycle, Scale, TrendingUp, Truck, Wallet } from "lucide-react";
import Link from "next/link";
import { HBarChart, RevenueCostChart, TrendChart, VBarChart } from "@/components/charts/charts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, StatCard } from "@/components/ui/page";
import { str, type SP } from "@/lib/list-params";
import { cn, formatInt, formatMoney, formatTonnes } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { getDashboard, periodRange, type Period } from "@/server/services/dashboard";

export const metadata = { title: "Dashboard" };

const PERIODS: { key: Period; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "year", label: "This Year" },
];

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("dashboard.view");
  const sp = await searchParams;
  const period = (str(sp, "period") as Period) ?? "month";
  const range = periodRange(period, str(sp, "from"), str(sp, "to"));
  const d = await getDashboard(range.from, range.to);
  const financial = user.permissions.includes("reports.financial");
  const k = d.kpis;

  const flow = [
    { label: "Customers", value: formatInt(d.flow.customers), href: "/customers" },
    { label: "Pickups", value: formatInt(d.flow.pickups), href: "/pickups" },
    { label: "Collection", value: `${formatInt(d.flow.collections)} trips`, href: "/collections" },
    { label: "Weighment", value: `${formatInt(d.flow.weighments)}`, href: "/weighments" },
    { label: "Segregation", value: `${formatInt(d.flow.batches)} batches`, href: "/processing" },
    { label: "Processing", value: formatTonnes(k.processedKg), href: "/processing" },
    { label: "Recovered Material", value: formatTonnes(d.flow.recoveredKg), href: "/inventory" },
    { label: "Sales / Disposal", value: `${formatInt(d.flow.sales)} sales`, href: "/sales" },
    { label: "Billing", value: `${formatInt(d.flow.invoices)} invoices`, href: "/invoices" },
    { label: "Payment", value: financial ? formatMoney(d.flow.receivedAmount) : `${formatInt(d.flow.payments)}`, href: "/receipts" },
  ];

  return (
    <>
      <PageHeader
        title="Management Dashboard"
        description={`Operations and financial overview · ${range.label}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
              {PERIODS.map((p) => (
                <Link
                  key={p.key}
                  href={`/dashboard?period=${p.key}`}
                  className={cn("rounded-md px-3 py-1.5 text-xs font-medium", period === p.key ? "bg-navy-700 text-white" : "text-slate-600 hover:bg-slate-100")}
                >
                  {p.label}
                </Link>
              ))}
            </div>
            <form method="get" className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5 pl-2 shadow-sm">
              <CalendarRange className="size-4 text-slate-400" />
              <input type="hidden" name="period" value="custom" />
              <input type="date" name="from" defaultValue={range.from} className="h-7 rounded border-0 text-xs" aria-label="From date" />
              <span className="text-xs text-slate-400">to</span>
              <input type="date" name="to" defaultValue={range.to} className="h-7 rounded border-0 text-xs" aria-label="To date" />
              <button className={cn("rounded-md px-3 py-1.5 text-xs font-medium", period === "custom" ? "bg-navy-700 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200")}>Custom</button>
            </form>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Total Customers" value={formatInt(k.totalCustomers)} sub="Active accounts" icon={<Building2 />} tone="navy" href="/customers" />
        <StatCard label="Collection Trips Today" value={formatInt(k.tripsToday)} sub={`${k.weighmentsToday} weighments today`} icon={<Truck />} href="/schedule" />
        <StatCard label="Waste Collected Today" value={formatTonnes(k.collectedTodayKg)} sub={`${formatInt(k.collectedTodayKg)} kg net`} icon={<Scale />} href="/weighments" />
        <StatCard label="Collected This Month" value={formatTonnes(k.collectedMonthKg)} sub={`${formatInt(k.collectedMonthKg)} kg net`} icon={<Scale />} tone="navy" />
        <StatCard label="Waste Processed" value={formatTonnes(k.processedKg)} sub={range.label} icon={<Factory />} tone="slate" href="/processing" />
        <StatCard label="Recyclable Output" value={formatTonnes(k.recyclableOutputKg)} sub={`${k.recoveryPct}% recovery rate`} icon={<Recycle />} href="/inventory" />
        {financial && (
          <>
            <StatCard label="Revenue" value={formatMoney(k.salesRevenue)} sub={`Service ${formatMoney(k.serviceRevenue)} · Recyclables ${formatMoney(k.recyclableRevenue)}`} icon={<IndianRupee />} tone="navy" href="/reports/revenue" />
            <StatCard label="Customer Outstanding" value={formatMoney(k.outstanding)} sub="Unpaid invoice balance" icon={<Wallet />} tone="amber" href="/outstanding" />
            <StatCard label="Operating Cost" value={formatMoney(k.operatingCost)} sub="Expenses + purchases" icon={<Wallet />} tone="red" href="/expenses" />
            <StatCard label="Estimated Profit" value={formatMoney(k.estimatedProfit)} sub="Revenue − operating cost (excl. GST)" icon={<TrendingUp />} tone={k.estimatedProfit >= 0 ? "green" : "red"} href="/reports/profitability" />
          </>
        )}
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Process Flow</CardTitle>
          <span className="text-xs text-slate-500">{range.label}</span>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <ol className="flex min-w-max items-center gap-1.5">
            {flow.map((s, i) => (
              <li key={s.label} className="flex items-center gap-1.5">
                <Link href={s.href} className="block w-[7.6rem] rounded-lg border border-slate-200 bg-gradient-to-b from-white to-slate-50 px-3 py-2.5 text-center transition hover:border-brand-400 hover:shadow-sm">
                  <span className="mx-auto mb-1 flex size-6 items-center justify-center rounded-full bg-brand-600 text-[11px] font-semibold text-white">{i + 1}</span>
                  <span className="block text-[11px] font-semibold uppercase tracking-wide text-navy-700">{s.label}</span>
                  <span className="num mt-0.5 block truncate text-xs text-slate-500">{s.value}</span>
                </Link>
                {i < flow.length - 1 && <ArrowRight className="size-4 shrink-0 text-brand-500" />}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>Waste Collection Trend (net weight)</CardTitle></CardHeader>
          <CardContent className="h-72"><TrendChart data={d.charts.trend} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Waste Type Distribution</CardTitle></CardHeader>
          <CardContent className="h-72"><HBarChart data={d.charts.wasteTypes} /></CardContent>
        </Card>
        {financial && (
          <Card className="xl:col-span-2">
            <CardHeader><CardTitle>Revenue vs Operating Cost (last 6 months)</CardTitle></CardHeader>
            <CardContent className="h-72"><RevenueCostChart data={d.charts.revenueVsCost} /></CardContent>
          </Card>
        )}
        <Card>
          <CardHeader><CardTitle>Processing Output (recovered material)</CardTitle></CardHeader>
          <CardContent className="h-72"><HBarChart data={d.charts.processing} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recyclable Sales by Material</CardTitle></CardHeader>
          <CardContent className="h-72"><HBarChart data={d.charts.sales} valueKey={financial ? "value" : "qty"} money={financial} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Vehicle Performance (net collected)</CardTitle></CardHeader>
          <CardContent className="h-72"><VBarChart data={d.charts.vehicles.map((v) => ({ name: v.name, kg: v.kg, trips: v.trips }))} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Top Customers by Collection</CardTitle></CardHeader>
          <CardContent className="h-72"><HBarChart data={d.charts.customers} /></CardContent>
        </Card>
      </div>
    </>
  );
}
