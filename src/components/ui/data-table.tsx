import Link from "next/link";
import { ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  hideOnMobile?: boolean;
};

/** Server-rendered table. Paging, sorting and filtering happen on the server via URL params. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty = "No records found",
  emptyHint,
  footer,
  dense,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: string;
  emptyHint?: React.ReactNode;
  footer?: React.ReactNode;
  dense?: boolean;
}) {
  if (rows.length === 0) return <EmptyState title={empty} hint={emptyHint} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            {columns.map((c) => (
              <th
                key={c.key}
                className={cn("whitespace-nowrap px-4 py-2.5", c.align === "right" && "text-right", c.align === "center" && "text-center", c.hideOnMobile && "hidden md:table-cell")}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={rowKey(r)} className="hover:bg-slate-50/70">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    "px-4",
                    dense ? "py-1.5" : "py-2.5",
                    c.align === "right" && "num text-right",
                    c.align === "center" && "text-center",
                    c.hideOnMobile && "hidden md:table-cell",
                    c.className,
                  )}
                >
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer}
      </table>
    </div>
  );
}

export function EmptyState({ title, hint, icon }: { title: string; hint?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-400">{icon ?? <Inbox className="size-6" />}</div>
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint && <div className="mt-1 text-sm text-slate-500">{hint}</div>}
    </div>
  );
}

export function Pagination({ page, pageSize, total, params }: { page: number; pageSize: number; total: number; params: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "page") sp.set(k, v);
    sp.set("page", String(p));
    return `?${sp.toString()}`;
  };
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
      <span>
        Showing <b className="text-slate-700">{from}</b>–<b className="text-slate-700">{to}</b> of <b className="text-slate-700">{total}</b>
      </span>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link href={href(page - 1)} className="rounded-md border border-slate-200 p-1.5 hover:bg-slate-50" aria-label="Previous page">
            <ChevronLeft className="size-4" />
          </Link>
        ) : (
          <span className="rounded-md border border-slate-100 p-1.5 text-slate-300"><ChevronLeft className="size-4" /></span>
        )}
        <span className="px-2">Page {page} of {pages}</span>
        {page < pages ? (
          <Link href={href(page + 1)} className="rounded-md border border-slate-200 p-1.5 hover:bg-slate-50" aria-label="Next page">
            <ChevronRight className="size-4" />
          </Link>
        ) : (
          <span className="rounded-md border border-slate-100 p-1.5 text-slate-300"><ChevronRight className="size-4" /></span>
        )}
      </div>
    </div>
  );
}
