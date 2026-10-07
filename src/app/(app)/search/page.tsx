import { Search } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page";
import { str, type SP } from "@/lib/list-params";
import { requireUser } from "@/server/auth/current-user";
import { globalSearch } from "@/server/services/search";

export const metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const q = str(await searchParams, "q") ?? "";
  const hits = await globalSearch(q, user.permissions);
  const groups = [...new Set(hits.map((h) => h.type))];
  return (
    <>
      <PageHeader title="Search" description={q ? `Results for “${q}”` : "Search across customers, sites, invoices, pickups, weighments, vehicles, drivers, sales, payments and materials"} />
      <form className="mb-4 flex max-w-xl gap-2" method="get">
        <input name="q" defaultValue={q} autoFocus className="h-10 flex-1 rounded-lg border border-slate-300 px-3 text-sm" placeholder="Type at least 2 characters" aria-label="Search" />
        <button className="flex h-10 items-center gap-2 rounded-lg bg-navy-700 px-4 text-sm font-medium text-white"><Search className="size-4" /> Search</button>
      </form>
      {q.length >= 2 && hits.length === 0 && <Card><EmptyState title="Nothing found" hint="Check the spelling or try a number like an invoice or vehicle number." /></Card>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {groups.map((g) => (
          <Card key={g}>
            <div className="border-b border-slate-100 px-5 py-2.5 text-sm font-semibold text-navy-800">{g}</div>
            <ul className="divide-y divide-slate-100">
              {hits.filter((h) => h.type === g).map((h, i) => (
                <li key={i}><Link href={h.href} className="flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50"><Badge tone="blue">{h.type}</Badge><span className="min-w-0"><span className="block truncate text-sm font-medium">{h.title}</span><span className="block truncate text-xs text-slate-500">{h.subtitle}</span></span></Link></li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
