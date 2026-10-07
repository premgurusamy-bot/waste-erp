import { BarChart3, ChevronRight, Lock } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { requirePermission } from "@/server/auth/current-user";
import { canRun, REPORTS } from "@/server/reports";

export const metadata = { title: "Reports" };

export default async function ReportsIndex() {
  const user = await requirePermission("reports.view");
  const groups = [...new Set(REPORTS.map((r) => r.group))];
  return (
    <>
      <PageHeader title="Reports" description="All reports support date and relevant filters, search, Excel/CSV/PDF export and print" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {groups.map((g) => (
          <Card key={g}>
            <div className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-navy-800">{g}</div>
            <ul className="divide-y divide-slate-100">
              {REPORTS.filter((r) => r.group === g).map((r) => {
                const ok = canRun(r, user.permissions);
                return (
                  <li key={r.key}>
                    {ok ? (
                      <Link href={`/reports/${r.key}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                        <BarChart3 className="size-4 text-brand-600" />
                        <span className="flex-1"><span className="block text-sm font-medium text-slate-800">{r.title}</span><span className="block text-xs text-slate-500">{r.description}</span></span>
                        <ChevronRight className="size-4 text-slate-400" />
                      </Link>
                    ) : (
                      <div className="flex items-center gap-3 px-5 py-3 opacity-50" title="Your role does not include this report">
                        <Lock className="size-4" />
                        <span className="flex-1"><span className="block text-sm">{r.title}</span><span className="block text-xs">No access</span></span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
