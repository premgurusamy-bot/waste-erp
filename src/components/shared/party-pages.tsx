import { Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { saveEntityAction } from "@/app/actions/masters";
import { EntityForm } from "@/components/forms/entity-form";
import { ActiveToggle } from "@/components/shared/active-toggle";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { FilterBar, FilterField, FText, PageHeader, Section, StatCard } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { partyFields, toFormValues } from "@/lib/fields";
import { ci, flat, listParams, type SP } from "@/lib/list-params";
import { formatDate, formatMoney, num, round2 } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";

type Kind = "buyer" | "supplier";
const CFG = {
  buyer: { title: "Buyers", one: "Buyer", base: "/buyers", view: "sales.view", manage: "sales.manage", desc: "Recyclers and traders who buy recovered material" },
  supplier: { title: "Suppliers", one: "Supplier", base: "/suppliers", view: "purchases.view", manage: "purchases.manage", desc: "Vendors for purchases, fuel, repairs and services" },
} as const;

export async function PartyList({ kind, searchParams }: { kind: Kind; searchParams: Promise<SP> }) {
  const c = CFG[kind];
  const user = await requirePermission(c.view);
  const sp = await searchParams;
  const { page, pageSize, skip, take, q } = listParams(sp);
  const where = q ? { OR: [{ name: ci(q) }, { code: ci(q) }, { gstin: ci(q) }, { mobile: ci(q) }] } : {};
  const model = (kind === "buyer" ? prisma.buyer : prisma.supplier) as any;
  const [rows, total] = await Promise.all([model.findMany({ where, orderBy: { name: "asc" }, skip, take }), model.count({ where })]);
  return (
    <>
      <PageHeader title={c.title} description={c.desc} actions={user.permissions.includes(c.manage) && <Button asChild><Link href={`${c.base}/new`}><Plus /> New {c.one}</Link></Button>} />
      <Card>
        <FilterBar reset={c.base}>
          <FilterField label="Search" className="min-w-64 flex-1"><FText name="q" defaultValue={q} placeholder="Name, code, GSTIN, mobile" /></FilterField>
        </FilterBar>
        <DataTable
          rows={rows as any[]}
          rowKey={(r) => r.id}
          empty={`No ${c.title.toLowerCase()} found`}
          columns={[
            { key: "code", header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
            { key: "name", header: c.one, cell: (r) => <Link href={`${c.base}/${r.id}`} className="font-medium text-navy-700 hover:underline">{r.name}</Link> },
            { key: "gstin", header: "GSTIN", cell: (r) => <span className="font-mono text-xs">{r.gstin}</span> },
            { key: "contact", header: "Contact", cell: (r) => [r.contactPerson, r.mobile].filter(Boolean).join(" · ") },
            { key: "addr", header: "Address", hideOnMobile: true, cell: (r) => r.address },
            { key: "terms", header: "Payment Terms", align: "right", cell: (r) => `${r.paymentTermsDays} d` },
            { key: "st", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
        <Pagination page={page} pageSize={pageSize} total={total} params={flat(sp)} />
      </Card>
    </>
  );
}

export async function PartyNew({ kind }: { kind: Kind }) {
  const c = CFG[kind];
  await requirePermission(c.manage);
  return (
    <>
      <PageHeader title={`New ${c.one}`} crumbs={[{ href: c.base, label: c.title }]} />
      <Card><CardContent>
        <EntityForm schemaKey={kind} fields={partyFields(c.one)} defaultValues={{ status: "ACTIVE", paymentTermsDays: kind === "buyer" ? "15" : "30" }} action={saveEntityAction.bind(null, kind, null)} submitLabel={`Create ${c.one}`} redirectTo={`${c.base}/:id`} cancelHref={c.base} />
      </CardContent></Card>
    </>
  );
}

export async function PartyDetail({ kind, params }: { kind: Kind; params: Promise<{ id: string }> }) {
  const c = CFG[kind];
  const user = await requirePermission(c.view);
  const { id } = await params;
  const rec: any = kind === "buyer" ? await prisma.buyer.findUnique({ where: { id } }) : await prisma.supplier.findUnique({ where: { id } });
  if (!rec) notFound();
  const docs =
    kind === "buyer"
      ? (await prisma.salesInvoice.findMany({ where: { buyerId: id }, orderBy: { date: "desc" }, take: 50 })).map((s) => ({ id: s.id, href: `/sales/${s.id}`, number: s.number, date: s.date, total: num(s.total), paid: num(s.amountReceived), status: s.status, pay: s.paymentStatus }))
      : [
          ...(await prisma.purchase.findMany({ where: { supplierId: id }, orderBy: { date: "desc" }, take: 50 })).map((p) => ({ id: p.id, href: `/purchases/${p.id}`, number: p.number, date: p.date, total: num(p.total), paid: num(p.amountPaid), status: p.status, pay: p.paymentStatus })),
          ...(await prisma.expense.findMany({ where: { supplierId: id }, orderBy: { date: "desc" }, take: 50 })).map((p) => ({ id: p.id, href: `/expenses/${p.id}`, number: p.number, date: p.date, total: num(p.total), paid: num(p.amountPaid), status: p.status, pay: p.paymentStatus })),
        ].sort((a, b) => b.date.getTime() - a.date.getTime());
  const posted = docs.filter((d) => d.status === "POSTED");
  const total = round2(posted.reduce((s, d) => s + d.total, 0));
  const paid = round2(posted.reduce((s, d) => s + d.paid, 0));
  const manage = user.permissions.includes(c.manage);
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-2">{rec.name} <StatusBadge status={rec.status} /></span>} description={`${rec.code}${rec.gstin ? ` · GSTIN ${rec.gstin}` : ""}`} crumbs={[{ href: c.base, label: c.title }]} actions={manage && <ActiveToggle entity={kind} id={id} active={rec.status === "ACTIVE"} label={rec.name} />} />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <StatCard label={kind === "buyer" ? "Total Sales" : "Total Bills"} value={formatMoney(total)} tone="navy" />
        <StatCard label={kind === "buyer" ? "Received" : "Paid"} value={formatMoney(paid)} />
        <StatCard label="Balance" value={formatMoney(total - paid)} tone={total - paid > 0 ? "amber" : "green"} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title={`${c.one} Details`}>
          <CardContent>
            {manage ? (
              <EntityForm schemaKey={kind} fields={partyFields(c.one)} defaultValues={toFormValues(rec)} action={saveEntityAction.bind(null, kind, id)} cols={2} successMessage={`${c.one} updated`} />
            ) : (
              <p className="text-sm text-slate-600">{[rec.contactPerson, rec.mobile, rec.email, rec.address].filter(Boolean).join(" · ")}</p>
            )}
          </CardContent>
        </Section>
        <Section title="Transactions">
          <DataTable
            rows={docs}
            rowKey={(d) => d.id}
            empty="No transactions"
            columns={[
              { key: "n", header: "Number", cell: (d) => <Link className="text-navy-700 hover:underline" href={d.href}>{d.number}</Link> },
              { key: "d", header: "Date", cell: (d) => formatDate(d.date) },
              { key: "t", header: "Total", align: "right", cell: (d) => formatMoney(d.total) },
              { key: "p", header: kind === "buyer" ? "Received" : "Paid", align: "right", cell: (d) => formatMoney(d.paid) },
              { key: "s", header: "Status", cell: (d) => <StatusBadge status={d.status === "CANCELLED" ? "CANCELLED" : d.pay} /> },
            ]}
          />
        </Section>
      </div>
    </>
  );
}
