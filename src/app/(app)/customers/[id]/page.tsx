import { FileDown, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { saveEntityAction } from "@/app/actions/masters";
import { EntityForm } from "@/components/forms/entity-form";
import { FormDialog } from "@/components/forms/confirm-action";
import { ActiveToggle } from "@/components/shared/active-toggle";
import { DocumentsPanel } from "@/components/shared/documents-panel";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { DetailGrid, FilterBar, FilterField, FText, LinkTabs, PageHeader, Section, StatCard } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { contactFields } from "@/lib/fields";
import { str, type SP } from "@/lib/list-params";
import { daysBetween, formatDate, formatDateTime, formatMoney, formatQty, formatTonnes, num, round2, STATES, titleCase, todayISO, dateOnly } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { customerStatement } from "@/server/statement";

export default async function CustomerProfile({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const user = await requirePermission("customers.view");
  const { id } = await params;
  const sp = await searchParams;
  const tab = str(sp, "tab") ?? "overview";
  const c = await prisma.customer.findUnique({
    where: { id },
    include: { sites: { include: { defaultWasteType: true }, orderBy: { name: "asc" } }, contacts: { orderBy: { isPrimary: "desc" } } },
  });
  if (!c) notFound();
  const can = (p: string) => user.permissions.includes(p);

  const [wAgg, cCount, invAgg, rcAgg, counts] = await Promise.all([
    prisma.weighment.aggregate({ where: { customerId: id, status: "COMPLETED" }, _sum: { netWeight: true }, _count: true }),
    prisma.collectionEntry.count({ where: { customerId: id, status: { not: "NOT_COLLECTED" } } }),
    prisma.customerInvoice.aggregate({ where: { customerId: id, status: "POSTED" }, _sum: { total: true, amountReceived: true } }),
    prisma.receipt.aggregate({ where: { customerId: id, status: "POSTED" }, _sum: { amount: true, allocatedAmount: true } }),
    Promise.all([
      prisma.contract.count({ where: { customerId: id } }),
      prisma.customerInvoice.count({ where: { customerId: id } }),
      prisma.receipt.count({ where: { customerId: id } }),
    ]),
  ]);
  const outstanding = round2(num(invAgg._sum.total) - num(invAgg._sum.amountReceived));
  const advance = round2(num(rcAgg._sum.amount) - num(rcAgg._sum.allocatedAmount));
  const base = `/customers/${id}`;

  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">{c.name} <StatusBadge status={c.status} />{c.isDemo && <Badge tone="purple">Demo data</Badge>}</span>}
        description={`${c.code}${c.gstin ? ` · GSTIN ${c.gstin}` : ""}${c.city ? ` · ${c.city}` : ""}`}
        crumbs={[{ href: "/customers", label: "Customers" }]}
        actions={
          <>
            {can("customers.manage") && <Button variant="outline" size="sm" asChild><Link href={`${base}/edit`}><Pencil /> Edit</Link></Button>}
            {can("customers.manage") && <ActiveToggle entity="customer" id={id} active={c.status === "ACTIVE"} label={c.name} />}
            {can("pickups.manage") && <Button size="sm" asChild><Link href={`/pickups/new?customerId=${id}`}><Plus /> Pickup</Link></Button>}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Total Waste Collected" value={formatTonnes(wAgg._sum.netWeight)} sub={`${wAgg._count} weighments · ${cCount} trips`} />
        <StatCard label="Total Billing" value={formatMoney(invAgg._sum.total)} tone="navy" />
        <StatCard label="Total Payments" value={formatMoney(rcAgg._sum.amount)} />
        <StatCard label="Outstanding" value={formatMoney(outstanding)} tone={outstanding > 0 ? "amber" : "green"} sub={advance > 0 ? `Unallocated advance ${formatMoney(advance)}` : undefined} />
        <StatCard label="Credit Period" value={`${c.creditDays} days`} tone="slate" />
      </div>

      <LinkTabs
        base={base}
        active={tab}
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "contracts", label: "Contracts", count: counts[0] },
          { key: "collections", label: "Collections" },
          { key: "weighments", label: "Weighments" },
          { key: "invoices", label: "Invoices", count: counts[1] },
          { key: "payments", label: "Payments", count: counts[2] },
          { key: "outstanding", label: "Outstanding" },
          { key: "statement", label: "Statement" },
          { key: "documents", label: "Documents" },
        ]}
      />

      {tab === "overview" && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardContent>
              <DetailGrid
                items={[
                  { label: "Customer Code", value: c.code },
                  { label: "GSTIN", value: c.gstin },
                  { label: "State", value: c.stateCode ? `${c.stateCode} - ${STATES[c.stateCode] ?? ""}` : "" },
                  { label: "Contact Person", value: c.contactPerson },
                  { label: "Mobile", value: c.mobile },
                  { label: "Email", value: c.email },
                  { label: "Address", value: [c.address, c.city, c.pincode].filter(Boolean).join(", ") },
                  { label: "Credit Period", value: `${c.creditDays} days` },
                  { label: "Remarks", value: c.remarks },
                ]}
              />
            </CardContent>
          </Card>
          <Section
            title="Contacts"
            actions={
              can("customers.manage") && (
                <FormDialog label="Add" icon={<Plus />} title="Add contact">
                  <EntityForm schemaKey="customerContact" fields={contactFields()} defaultValues={{ customerId: id }} action={async (v) => { "use server"; return saveEntityAction("customerContact", null, { ...v, customerId: id }); }} cols={2} successMessage="Contact added" />
                </FormDialog>
              )
            }
          >
            <ul className="divide-y divide-slate-100">
              {c.contacts.length === 0 && <li className="px-5 py-4 text-sm text-slate-500">No contacts yet.</li>}
              {c.contacts.map((p) => (
                <li key={p.id} className="px-5 py-2.5 text-sm">
                  <p className="font-medium">{p.name} {p.isPrimary && <Badge tone="green">Primary</Badge>}</p>
                  <p className="text-xs text-slate-500">{[p.designation, p.mobile, p.email].filter(Boolean).join(" · ")}</p>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Sites" className="xl:col-span-3" actions={can("customers.manage") && <Button size="sm" variant="outline" asChild><Link href={`/sites/new?customerId=${id}`}><Plus /> Add Site</Link></Button>}>
            <DataTable
              rows={c.sites}
              rowKey={(s) => s.id}
              empty="No sites yet"
              columns={[
                { key: "code", header: "Code", cell: (s) => <span className="font-mono text-xs">{s.code}</span> },
                { key: "name", header: "Site", cell: (s) => <Link href={`/sites/${s.id}`} className="font-medium text-navy-700 hover:underline">{s.name}</Link> },
                { key: "addr", header: "Address", hideOnMobile: true, cell: (s) => s.address },
                { key: "wt", header: "Waste Type", cell: (s) => s.defaultWasteType?.name },
                { key: "freq", header: "Frequency", cell: (s) => `${titleCase(s.frequency)}${s.collectionTime ? ` @ ${s.collectionTime}` : ""}` },
                { key: "st", header: "Status", cell: (s) => <StatusBadge status={s.status} /> },
              ]}
            />
          </Section>
        </div>
      )}

      {tab === "contracts" && <ContractsTab customerId={id} />}
      {tab === "collections" && <CollectionsTab customerId={id} />}
      {tab === "weighments" && <WeighmentsTab customerId={id} />}
      {tab === "invoices" && <InvoicesTab customerId={id} />}
      {tab === "payments" && <PaymentsTab customerId={id} />}
      {tab === "outstanding" && <OutstandingTab customerId={id} />}
      {tab === "statement" && <StatementTab customerId={id} sp={sp} />}
      {tab === "documents" && <DocumentsPanel entityType="customer" entityId={id} category="CUSTOMER_AGREEMENT" categories={["CUSTOMER_AGREEMENT", "OTHER"]} canUpload={can("customers.manage") || can("documents.manage")} />}
    </>
  );
}

async function ContractsTab({ customerId }: { customerId: string }) {
  const rows = await prisma.contract.findMany({ where: { customerId }, include: { rates: { where: { status: "ACTIVE" } } }, orderBy: { startDate: "desc" } });
  return (
    <Card>
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        empty="No contracts"
        columns={[
          { key: "n", header: "Contract", cell: (r) => <Link href={`/contracts/${r.id}`} className="font-medium text-navy-700 hover:underline">{r.number}</Link> },
          { key: "t", header: "Title", cell: (r) => r.title },
          { key: "p", header: "Period", cell: (r) => `${formatDate(r.startDate)} – ${r.endDate ? formatDate(r.endDate) : "Open"}` },
          { key: "r", header: "Active Rates", align: "right", cell: (r) => r.rates.length },
          { key: "s", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
        ]}
      />
    </Card>
  );
}

async function CollectionsTab({ customerId }: { customerId: string }) {
  const rows = await prisma.collectionEntry.findMany({ where: { customerId }, include: { site: true, vehicle: true, driver: true, wasteType: true }, orderBy: { collectionDate: "desc" }, take: 100 });
  return (
    <Card>
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        empty="No collections recorded"
        columns={[
          { key: "n", header: "Collection", cell: (r) => <span className="font-mono text-xs">{r.number}</span> },
          { key: "d", header: "Date", cell: (r) => formatDateTime(r.collectionDate) },
          { key: "s", header: "Site", cell: (r) => r.site.name },
          { key: "w", header: "Waste", cell: (r) => r.wasteType.name },
          { key: "v", header: "Vehicle / Driver", cell: (r) => `${r.vehicle.number} · ${r.driver?.name ?? "-"}` },
          { key: "q", header: "Actual Qty", align: "right", cell: (r) => formatQty(r.actualQty ?? r.estimatedQty, "kg") },
          { key: "st", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
          { key: "b", header: "Billed", cell: (r) => (r.customerInvoiceItemId ? <Badge tone="green">Billed</Badge> : <Badge>Unbilled</Badge>) },
        ]}
      />
    </Card>
  );
}

async function WeighmentsTab({ customerId }: { customerId: string }) {
  const rows = await prisma.weighment.findMany({ where: { customerId }, include: { vehicle: true, wasteType: true, site: true }, orderBy: { gateInAt: "desc" }, take: 100 });
  return (
    <Card>
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        empty="No weighments"
        columns={[
          { key: "n", header: "Weighment", cell: (r) => <Link href={`/weighments/${r.id}`} className="font-medium text-navy-700 hover:underline">{r.number}</Link> },
          { key: "d", header: "Gate In", cell: (r) => formatDateTime(r.gateInAt) },
          { key: "v", header: "Vehicle", cell: (r) => r.vehicle.number },
          { key: "w", header: "Waste", cell: (r) => r.wasteType.name },
          { key: "g", header: "Gross", align: "right", cell: (r) => formatQty(r.grossWeight) },
          { key: "t", header: "Tare", align: "right", cell: (r) => formatQty(r.tareWeight) },
          { key: "nt", header: "Net (KG)", align: "right", cell: (r) => <b>{formatQty(r.netWeight)}</b> },
          { key: "s", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
        ]}
      />
    </Card>
  );
}

async function InvoicesTab({ customerId }: { customerId: string }) {
  const rows = await prisma.customerInvoice.findMany({ where: { customerId }, orderBy: { date: "desc" }, take: 100 });
  return (
    <Card>
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        empty="No invoices"
        columns={[
          { key: "n", header: "Invoice", cell: (r) => <Link href={`/invoices/${r.id}`} className="font-medium text-navy-700 hover:underline">{r.number}</Link> },
          { key: "d", header: "Date", cell: (r) => formatDate(r.date) },
          { key: "p", header: "Period", cell: (r) => (r.periodFrom ? `${formatDate(r.periodFrom)} – ${formatDate(r.periodTo)}` : "") },
          { key: "t", header: "Total", align: "right", cell: (r) => formatMoney(r.total) },
          { key: "r", header: "Received", align: "right", cell: (r) => formatMoney(r.amountReceived) },
          { key: "b", header: "Balance", align: "right", cell: (r) => formatMoney(num(r.total) - num(r.amountReceived)) },
          { key: "due", header: "Due", cell: (r) => formatDate(r.dueDate) },
          { key: "s", header: "Status", cell: (r) => (r.status === "CANCELLED" ? <StatusBadge status="CANCELLED" /> : <StatusBadge status={r.paymentStatus} />) },
        ]}
      />
    </Card>
  );
}

async function PaymentsTab({ customerId }: { customerId: string }) {
  const rows = await prisma.receipt.findMany({ where: { customerId }, include: { allocations: { include: { customerInvoice: true } } }, orderBy: { date: "desc" }, take: 100 });
  return (
    <Card>
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        empty="No payments received"
        columns={[
          { key: "n", header: "Receipt", cell: (r) => <Link href={`/receipts/${r.id}`} className="font-medium text-navy-700 hover:underline">{r.number}</Link> },
          { key: "d", header: "Date", cell: (r) => formatDate(r.date) },
          { key: "m", header: "Mode", cell: (r) => titleCase(r.mode) },
          { key: "ref", header: "Reference", cell: (r) => r.reference },
          { key: "a", header: "Amount", align: "right", cell: (r) => formatMoney(r.amount) },
          { key: "al", header: "Against", cell: (r) => r.allocations.map((a) => a.customerInvoice?.number).filter(Boolean).join(", ") || <span className="text-amber-700">Advance</span> },
          { key: "s", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
        ]}
      />
    </Card>
  );
}

async function OutstandingTab({ customerId }: { customerId: string }) {
  const today = dateOnly(todayISO());
  const rows = await prisma.customerInvoice.findMany({ where: { customerId, status: "POSTED", paymentStatus: { not: "PAID" } }, orderBy: { date: "asc" } });
  return (
    <Card>
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        empty="Nothing outstanding"
        columns={[
          { key: "n", header: "Invoice", cell: (r) => <Link href={`/invoices/${r.id}`} className="font-medium text-navy-700 hover:underline">{r.number}</Link> },
          { key: "d", header: "Date", cell: (r) => formatDate(r.date) },
          { key: "due", header: "Due Date", cell: (r) => formatDate(r.dueDate) },
          { key: "t", header: "Amount", align: "right", cell: (r) => formatMoney(r.total) },
          { key: "r", header: "Received", align: "right", cell: (r) => formatMoney(r.amountReceived) },
          { key: "b", header: "Balance", align: "right", cell: (r) => <b>{formatMoney(num(r.total) - num(r.amountReceived))}</b> },
          { key: "age", header: "Age", align: "right", cell: (r) => { const a = daysBetween(r.dueDate, today); return a > 0 ? <span className="text-red-600">{a} days overdue</span> : "Current"; } },
        ]}
      />
    </Card>
  );
}

async function StatementTab({ customerId, sp }: { customerId: string; sp: SP }) {
  const to = str(sp, "to") ?? todayISO();
  const from = str(sp, "from") ?? `${to.slice(0, 4)}-01-01`;
  const st = await customerStatement(customerId, from, to);
  const exportQs = `customerId=${customerId}&from=${from}&to=${to}`;
  return (
    <Card>
      <FilterBar>
        <input type="hidden" name="tab" value="statement" />
        <FilterField label="From"><FText type="date" name="from" defaultValue={from} /></FilterField>
        <FilterField label="To"><FText type="date" name="to" defaultValue={to} /></FilterField>
        <a href={`/api/statement?${exportQs}&format=pdf`} className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-sm hover:bg-slate-50"><FileDown className="size-4" /> PDF</a>
        <a href={`/api/statement?${exportQs}&format=xlsx`} className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-sm hover:bg-slate-50"><FileDown className="size-4" /> Excel</a>
      </FilterBar>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
              <th className="px-4 py-2">Date</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Number</th><th className="px-4 py-2">Details</th>
              <th className="px-4 py-2 text-right">Debit</th><th className="px-4 py-2 text-right">Credit</th><th className="px-4 py-2 text-right">Balance</th>
            </tr>
          </thead>
          <tbody className="num divide-y divide-slate-100">
            <tr className="bg-slate-50/50"><td className="px-4 py-2" colSpan={6}>Opening balance as on {formatDate(from)}</td><td className="px-4 py-2 text-right font-medium">{formatMoney(st.opening)}</td></tr>
            {st.lines.map((l, i) => (
              <tr key={i}>
                <td className="px-4 py-2">{formatDate(l.date)}</td><td className="px-4 py-2">{l.type}</td><td className="px-4 py-2 font-mono text-xs">{l.number}</td><td className="px-4 py-2 text-slate-600">{l.description}</td>
                <td className="px-4 py-2 text-right">{l.debit ? formatMoney(l.debit) : ""}</td><td className="px-4 py-2 text-right">{l.credit ? formatMoney(l.credit) : ""}</td><td className="px-4 py-2 text-right">{formatMoney(l.balance)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
              <td className="px-4 py-2" colSpan={4}>Closing balance as on {formatDate(to)}</td>
              <td className="px-4 py-2 text-right">{formatMoney(st.totalDebit)}</td><td className="px-4 py-2 text-right">{formatMoney(st.totalCredit)}</td><td className="px-4 py-2 text-right">{formatMoney(st.closing)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}
