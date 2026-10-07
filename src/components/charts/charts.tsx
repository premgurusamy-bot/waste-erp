"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const BRAND = "#039855";
const S1 = "#2a78d6";
const S2 = "#eb6834";
const GRID = "#e2e8f0";
const AXIS = { fontSize: 11, fill: "#64748b" };

const kgFmt = (v: number) => (v >= 1000 ? `${(v / 1000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} T` : `${Math.round(v)} kg`);
const inrFmt = (v: number) =>
  Math.abs(v) >= 100000 ? `₹${(v / 100000).toLocaleString("en-IN", { maximumFractionDigits: 1 })}L` : `₹${Math.round(v).toLocaleString("en-IN")}`;
const fullKg = (v: number) => `${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })} kg`;
const fullInr = (v: number) => `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const tooltipStyle = { borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12, boxShadow: "0 4px 12px rgba(15,23,42,.08)" };

function Empty() {
  return <div className="flex h-full items-center justify-center text-sm text-slate-400">No data for this period</div>;
}

export function TrendChart({ data }: { data: { date: string; kg: number }[] }) {
  if (!data.some((d) => d.kg > 0)) return <Empty />;
  const label = (d: string) => (d.length === 7 ? d : `${d.slice(8, 10)}/${d.slice(5, 7)}`);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BRAND} stopOpacity={0.25} />
            <stop offset="100%" stopColor={BRAND} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tickFormatter={label} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={16} />
        <YAxis tickFormatter={kgFmt} tick={AXIS} tickLine={false} axisLine={false} width={56} />
        <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => String(l)} formatter={(v) => [fullKg(Number(v)), "Net collected"]} cursor={{ stroke: "#94a3b8", strokeDasharray: "3 3" }} />
        <Area type="linear" dataKey="kg" stroke={BRAND} strokeWidth={2} fill="url(#trendFill)" activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Horizontal bars for category magnitude (single hue: identity is carried by the axis label). */
export function HBarChart({ data, valueKey = "kg", money }: { data: { name: string; [k: string]: string | number }[]; valueKey?: string; money?: boolean }) {
  if (!data.length) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }} barCategoryGap={6}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" tickFormatter={money ? inrFmt : kgFmt} tick={AXIS} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="name" tick={AXIS} tickLine={false} axisLine={false} width={118} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#f1f5f9" }} formatter={(v) => [money ? fullInr(Number(v)) : fullKg(Number(v)), money ? "Value" : "Quantity"]} />
        <Bar dataKey={valueKey} fill={BRAND} radius={[0, 4, 4, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function RevenueCostChart({ data }: { data: { month: string; revenue: number; cost: number }[] }) {
  if (!data.length) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis tickFormatter={inrFmt} tick={AXIS} tickLine={false} axisLine={false} width={56} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#f1f5f9" }} formatter={(v, n) => [fullInr(Number(v)), n === "revenue" ? "Revenue" : "Operating cost"]} />
        <Legend formatter={(v) => <span className="text-xs text-slate-600">{v === "revenue" ? "Revenue" : "Operating cost"}</span>} iconType="circle" iconSize={8} />
        <Bar dataKey="revenue" fill={S1} radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Bar dataKey="cost" fill={S2} radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function VBarChart({ data, valueKey = "kg" }: { data: { name: string; [k: string]: string | number }[]; valueKey?: string }) {
  if (!data.length) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} interval={0} />
        <YAxis tickFormatter={kgFmt} tick={AXIS} tickLine={false} axisLine={false} width={56} />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ fill: "#f1f5f9" }}
          formatter={(v, _n, p) => [`${fullKg(Number(v))}${(p?.payload as any)?.trips ? ` · ${(p?.payload as any).trips} weighments` : ""}`, "Collected"]}
        />
        <Bar dataKey={valueKey} fill={BRAND} radius={[4, 4, 0, 0]} maxBarSize={44} />
      </BarChart>
    </ResponsiveContainer>
  );
}
