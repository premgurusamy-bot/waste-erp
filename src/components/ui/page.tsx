import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  crumbs,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  crumbs?: { href: string; label: string }[];
}) {
  return (
    <div className="mb-5">
      {crumbs && crumbs.length > 0 && (
        <nav className="mb-1 flex flex-wrap items-center gap-1 text-xs text-slate-500 no-print" aria-label="Breadcrumb">
          {crumbs.map((c) => (
            <span key={c.href} className="flex items-center gap-1">
              <Link href={c.href} className="hover:text-brand-700">{c.label}</Link>
              <ChevronRight className="size-3" />
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-navy-800 sm:text-2xl">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 no-print">{actions}</div>}
      </div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  tone = "green",
  href,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: "green" | "navy" | "amber" | "red" | "slate";
  href?: string;
}) {
  const tones = {
    green: "bg-brand-50 text-brand-700",
    navy: "bg-navy-50 text-navy-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    slate: "bg-slate-100 text-slate-700",
  };
  const body = (
    <div className="flex h-full items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <p className="num mt-1.5 truncate text-xl font-semibold text-navy-800">{value}</p>
        {sub && <p className="mt-0.5 truncate text-xs text-slate-500">{sub}</p>}
      </div>
      {icon && <div className={cn("rounded-lg p-2 [&_svg]:size-5", tones[tone])}>{icon}</div>}
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

export function DetailGrid({ items, cols = 3 }: { items: { label: string; value: React.ReactNode }[]; cols?: 2 | 3 | 4 }) {
  const c = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" }[cols];
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3", c)}>
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-xs font-medium text-slate-500">{i.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-slate-800">{i.value || <span className="text-slate-400">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function LinkTabs({ tabs, active, base }: { tabs: { key: string; label: string; count?: number }[]; active: string; base: string }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-slate-200 no-print">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={`${base}${base.includes("?") ? "&" : "?"}tab=${t.key}`}
          className={cn(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
            active === t.key ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{t.count}</span>}
        </Link>
      ))}
    </div>
  );
}

/** Plain GET form: filters work even without JavaScript and keep URLs shareable. */
export function FilterBar({ children, reset }: { children: React.ReactNode; reset?: string }) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-2 border-b border-slate-100 px-4 py-3 no-print">
      {children}
      <button type="submit" className="h-9 rounded-lg bg-navy-700 px-4 text-sm font-medium text-white hover:bg-navy-800">Apply</button>
      {reset && <Link href={reset} className="h-9 rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100">Reset</Link>}
    </form>
  );
}

export function FilterField({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block min-w-[9rem]", className)}>
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}

const fieldCls =
  "h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

export function FText(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(fieldCls, props.className)} />;
}
export function FSelect({ options, placeholder = "All", ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <select {...props} className={cn(fieldCls, props.className)}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function Section({ title, actions, children, className }: { title: string; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-slate-200 bg-white shadow-sm", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-navy-800">{title}</h2>
        {actions && <div className="flex items-center gap-2 no-print">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
