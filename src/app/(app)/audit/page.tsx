import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { FilterBar, FilterField, FSelect, FText, PageHeader } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { ci, flat, listParams, str, type SP } from "@/lib/list-params";
import { formatDateTime, localDayRange, todayISO } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";

export const metadata = { title: "Audit Trail" };

const TONE: Record<string, "green" | "blue" | "red" | "amber" | "grey" | "purple"> = { CREATE: "green", UPDATE: "blue", CANCEL: "red", REVERSE: "red", DEACTIVATE: "red", OVERRIDE: "amber", LOGIN_FAILED: "amber", PASSWORD_RESET: "purple", DELETE: "red" };

function Changes({ oldV, newV }: { oldV: unknown; newV: unknown }) {
  const o = (oldV ?? {}) as Record<string, unknown>;
  const n = (newV ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])].filter((k) => !["id", "createdAt", "updatedAt", "createdById"].includes(k)).slice(0, 8);
  if (!keys.length) return null;
  const show = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v).slice(0, 60) : String(v).slice(0, 60));
  return (
    <ul className="space-y-0.5 text-xs">
      {keys.map((k) => (
        <li key={k}><span className="text-slate-500">{k}:</span> {k in o && <><span className="text-red-600 line-through">{show(o[k])}</span> → </>}<span className="text-brand-700">{show(n[k])}</span></li>
      ))}
    </ul>
  );
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("audit.view");
  const sp = await searchParams;
  const { page, pageSize, skip, take, q } = listParams(sp, 50);
  const to = str(sp, "to") ?? todayISO();
  const from = str(sp, "from") ?? to;
  const moduleKey = str(sp, "module");
  const action = str(sp, "action");
  const userId = str(sp, "userId");
  const where = {
    createdAt: localDayRange(from, to),
    ...(moduleKey ? { module: moduleKey } : {}),
    ...(action ? { action } : {}),
    ...(userId ? { userId } : {}),
    ...(q ? { OR: [{ recordLabel: ci(q) }, { recordId: q }, { username: ci(q) }] } : {}),
  };
  const [rows, total, users, modules] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
    prisma.auditLog.count({ where }),
    prisma.user.findMany({ orderBy: { username: "asc" } }),
    prisma.auditLog.findMany({ distinct: ["module"], select: { module: true } }),
  ]);
  return (
    <>
      <PageHeader title="Audit Trail" description="Who changed what, when and from where. Audit records cannot be edited or deleted from the application." />
      <Card>
        <FilterBar reset="/audit">
          <FilterField label="Search" className="min-w-48 flex-1"><FText name="q" defaultValue={q} placeholder="Record, user" /></FilterField>
          <FilterField label="User"><FSelect name="userId" defaultValue={userId} options={users.map((u) => ({ value: u.id, label: u.username }))} /></FilterField>
          <FilterField label="Module"><FSelect name="module" defaultValue={moduleKey} options={modules.map((m) => ({ value: m.module, label: m.module }))} /></FilterField>
          <FilterField label="Action"><FSelect name="action" defaultValue={action} options={["CREATE", "UPDATE", "CANCEL", "OVERRIDE", "ACTIVATE", "DEACTIVATE", "ASSIGN", "COMPLETE", "ALLOCATE", "LOGIN", "LOGIN_FAILED", "LOGOUT", "PASSWORD_RESET", "PASSWORD_CHANGE", "UPLOAD", "EXPORT", "EMAIL"].map((a) => ({ value: a, label: a }))} /></FilterField>
          <FilterField label="From"><FText type="date" name="from" defaultValue={from} /></FilterField>
          <FilterField label="To"><FText type="date" name="to" defaultValue={to} /></FilterField>
        </FilterBar>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          empty="No audit entries for these filters"
          columns={[
            { key: "t", header: "Date / Time", cell: (r) => <span className="whitespace-nowrap text-xs">{formatDateTime(r.createdAt)}</span> },
            { key: "u", header: "User", cell: (r) => r.username },
            { key: "a", header: "Action", cell: (r) => <Badge tone={TONE[r.action] ?? "grey"}>{r.action}</Badge> },
            { key: "m", header: "Module", cell: (r) => r.module },
            { key: "r", header: "Record", cell: (r) => <span className="text-sm">{r.recordLabel ?? r.recordId}</span> },
            { key: "c", header: "Previous → New Value", cell: (r) => <Changes oldV={r.oldValues} newV={r.newValues} /> },
            { key: "ip", header: "IP / Device", hideOnMobile: true, cell: (r) => <div className="max-w-40 truncate text-xs text-slate-500" title={r.userAgent ?? ""}>{r.ipAddress}<br />{r.userAgent?.slice(0, 40)}</div> },
          ]}
        />
        <Pagination page={page} pageSize={pageSize} total={total} params={flat(sp)} />
      </Card>
    </>
  );
}
