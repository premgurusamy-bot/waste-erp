import { Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { ledgerAccountAction } from "@/app/actions/accounts";
import { FormDialog } from "@/components/forms/confirm-action";
import { EntityForm, type FieldDef } from "@/components/forms/entity-form";
import { JournalForm } from "@/components/forms/journal-form";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { FilterBar, FilterField, FSelect, FText, LinkTabs, PageHeader, StatCard } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { opt, toFormValues } from "@/lib/fields";
import { str, type SP } from "@/lib/list-params";
import { dateOnly, formatDate, formatMoney, round2, titleCase, todayISO, addDays } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { ledgerOptions } from "@/server/options";
import { accountLedger, partyBalances, trialBalance } from "@/server/services/ledger";

export const metadata = { title: "Accounts" };

const SOURCE_LINK: Record<string, string> = { CUSTOMER_INVOICE: "/invoices/", SALES_INVOICE: "/sales/", RECEIPT: "/receipts/", PAYMENT: "/payments/", PURCHASE: "/purchases/", EXPENSE: "/expenses/" };

const accountFields: FieldDef[] = [
  { name: "code", label: "Code", required: true },
  { name: "name", label: "Account Name", required: true },
  { name: "type", label: "Type", type: "select", options: opt(["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"]), required: true },
  { name: "subType", label: "Sub-type", type: "select", options: opt(["CASH", "BANK", "RECEIVABLE", "PAYABLE", "SALES", "PURCHASE", "EXPENSE", "GST_INPUT", "GST_OUTPUT", "CAPITAL", "ROUND_OFF"]), help: "CASH/BANK accounts appear in receipts & payments" },
  { name: "openingBalance", label: "Opening Balance", type: "number" },
  { name: "active", label: "Active", type: "checkbox", help: "Active" },
];

export default async function AccountsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("accounts.view");
  const sp = await searchParams;
  const tab = str(sp, "tab") ?? "trial";
  const to = str(sp, "to") ?? todayISO();
  const from = str(sp, "from") ?? `${to.slice(0, 4)}-01-01`;
  const manage = user.permissions.includes("accounts.manage");
  const accounts = await ledgerOptions();
  const base = `/accounts?from=${from}&to=${to}`;
  return (
    <>
      <PageHeader
        title="Accounts"
        description="Double-entry ledger posted automatically from invoices, sales, receipts, purchases, expenses and payments"
        actions={manage && (
          <FormDialog label="Journal Voucher" icon={<Plus />} title="Manual journal voucher" description="For adjustments and opening entries. Debits must equal credits." variant="default" size="md" wide>
            <JournalForm accounts={accounts} today={todayISO()} />
          </FormDialog>
        )}
      />
      <LinkTabs base={base} active={tab} tabs={[
        { key: "trial", label: "Trial Balance" },
        { key: "ledger", label: "Ledger / Cash & Bank Book" },
        { key: "journals", label: "Journals" },
        { key: "receivables", label: "Receivables" },
        { key: "payables", label: "Payables" },
        { key: "chart", label: "Chart of Accounts" },
      ]} />
      {tab === "trial" && <Trial to={to} />}
      {tab === "ledger" && <Ledger sp={sp} from={from} to={to} accounts={accounts} />}
      {tab === "journals" && <Journals from={from} to={to} />}
      {(tab === "receivables" || tab === "payables") && <Parties kind={tab} />}
      {tab === "chart" && <Chart manage={manage} />}
      <p className="mt-3 text-xs text-slate-500">This module provides operational bookkeeping (ledgers, trial balance, receivables, payables, GST). Statutory financial statements and filings should be finalised by your accountant.</p>
    </>
  );
}

async function Trial({ to }: { to: string }) {
  const rows = await trialBalance(to);
  const dr = round2(rows.reduce((s, r) => s + r.debit, 0));
  const cr = round2(rows.reduce((s, r) => s + r.credit, 0));
  return (
    <Card>
      <FilterBar><input type="hidden" name="tab" value="trial" /><FilterField label="As on"><FText type="date" name="to" defaultValue={to} /></FilterField></FilterBar>
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        empty="No postings yet"
        columns={[
          { key: "c", header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
          { key: "n", header: "Account", cell: (r) => <Link className="text-navy-700 hover:underline" href={`/accounts?tab=ledger&account=${r.id}`}>{r.name}</Link> },
          { key: "t", header: "Type", cell: (r) => <Badge>{titleCase(r.type)}</Badge> },
          { key: "dr", header: "Debit", align: "right", cell: (r) => (r.debit ? formatMoney(r.debit) : "") },
          { key: "cr", header: "Credit", align: "right", cell: (r) => (r.credit ? formatMoney(r.credit) : "") },
        ]}
        footer={
          <tfoot><tr className="num border-t-2 border-slate-200 bg-slate-50 font-semibold"><td className="px-4 py-2" colSpan={3}>Total {dr === cr ? <Badge tone="green">Balanced</Badge> : <Badge tone="red">Difference {formatMoney(dr - cr)}</Badge>}</td><td className="px-4 py-2 text-right">{formatMoney(dr)}</td><td className="px-4 py-2 text-right">{formatMoney(cr)}</td></tr></tfoot>
        }
      />
    </Card>
  );
}

async function Ledger({ sp, from, to, accounts }: { sp: SP; from: string; to: string; accounts: { value: string; label: string }[] }) {
  const accountId = str(sp, "account") ?? (await prisma.ledgerAccount.findUnique({ where: { code: "1010" } }))?.id;
  const led = accountId ? await accountLedger(accountId, from, to) : null;
  return (
    <Card>
      <FilterBar>
        <input type="hidden" name="tab" value="ledger" />
        <FilterField label="Account" className="min-w-72"><FSelect name="account" defaultValue={accountId} options={accounts} placeholder="Select account" /></FilterField>
        <FilterField label="From"><FText type="date" name="from" defaultValue={from} /></FilterField>
        <FilterField label="To"><FText type="date" name="to" defaultValue={to} /></FilterField>
      </FilterBar>
      {led && (
        <>
          <div className="grid grid-cols-2 gap-3 border-b border-slate-100 p-4 lg:grid-cols-4">
            <StatCard label="Opening" value={formatMoney(led.opening)} tone="slate" />
            <StatCard label="Debits" value={formatMoney(led.totalDr)} />
            <StatCard label="Credits" value={formatMoney(led.totalCr)} tone="amber" />
            <StatCard label="Closing" value={formatMoney(led.closing)} tone="navy" sub={led.closing >= 0 ? "Debit balance" : "Credit balance"} />
          </div>
          <DataTable
            rows={led.rows}
            rowKey={(r) => r.id}
            dense
            empty="No entries in this period"
            columns={[
              { key: "d", header: "Date", cell: (r) => formatDate(r.date) },
              { key: "v", header: "Voucher", cell: (r) => <span className="font-mono text-xs">{r.number}</span> },
              { key: "s", header: "Source", cell: (r) => (r.sourceId && SOURCE_LINK[r.sourceType] ? <Link className="text-navy-700 hover:underline" href={`${SOURCE_LINK[r.sourceType]}${r.sourceId}`}>{r.sourceNumber}</Link> : r.sourceNumber) },
              { key: "n", header: "Narration", cell: (r) => <span className="text-xs">{r.narration}</span> },
              { key: "dr", header: "Debit", align: "right", cell: (r) => (r.debit ? formatMoney(r.debit) : "") },
              { key: "cr", header: "Credit", align: "right", cell: (r) => (r.credit ? formatMoney(r.credit) : "") },
              { key: "b", header: "Balance", align: "right", cell: (r) => <b>{formatMoney(r.balance)}</b> },
            ]}
          />
        </>
      )}
    </Card>
  );
}

async function Journals({ from, to }: { from: string; to: string }) {
  const entries = await prisma.journalEntry.findMany({
    where: { date: { gte: dateOnly(from), lt: addDays(dateOnly(to), 1) } },
    include: { lines: { include: { account: true } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  return (
    <Card>
      <FilterBar><input type="hidden" name="tab" value="journals" /><FilterField label="From"><FText type="date" name="from" defaultValue={from} /></FilterField><FilterField label="To"><FText type="date" name="to" defaultValue={to} /></FilterField></FilterBar>
      <DataTable
        rows={entries}
        rowKey={(e) => e.id}
        empty="No journals"
        columns={[
          { key: "d", header: "Date", cell: (e) => formatDate(e.date) },
          { key: "n", header: "Voucher", cell: (e) => <div><span className="font-mono text-xs">{e.number}</span>{e.isReversal && <Badge tone="red" className="ml-1">Reversal</Badge>}</div> },
          { key: "s", header: "Source", cell: (e) => (e.sourceId && SOURCE_LINK[e.sourceType] ? <Link className="text-navy-700 hover:underline" href={`${SOURCE_LINK[e.sourceType]}${e.sourceId}`}>{e.sourceNumber}</Link> : titleCase(e.sourceType)) },
          { key: "na", header: "Narration", cell: (e) => <span className="text-xs">{e.narration}</span> },
          { key: "l", header: "Entries", cell: (e) => <div className="num text-xs">{e.lines.map((l) => <div key={l.id}>{Number(l.debit) ? "Dr" : "  Cr"} {l.account.name} {formatMoney(Number(l.debit) || Number(l.credit))}</div>)}</div> },
        ]}
      />
    </Card>
  );
}

async function Parties({ kind }: { kind: "receivables" | "payables" }) {
  const rows = await partyBalances(kind);
  const href = (r: (typeof rows)[number]) => (r.partyType === "CUSTOMER" ? `/customers/${r.partyId}` : r.partyType === "BUYER" ? `/buyers/${r.partyId}` : `/suppliers/${r.partyId}`);
  return (
    <Card>
      <DataTable
        rows={rows}
        rowKey={(r) => r.partyId}
        empty={kind === "receivables" ? "Nothing receivable" : "Nothing payable"}
        columns={[
          { key: "n", header: "Party", cell: (r) => <Link className="text-navy-700 hover:underline" href={href(r)}>{r.name}</Link> },
          { key: "t", header: "Type", cell: (r) => <Badge>{titleCase(r.partyType)}</Badge> },
          { key: "dr", header: "Total Debits", align: "right", cell: (r) => formatMoney(r.debit) },
          { key: "cr", header: "Total Credits", align: "right", cell: (r) => formatMoney(r.credit) },
          { key: "b", header: kind === "receivables" ? "Receivable" : "Payable", align: "right", cell: (r) => <b className={r.balance < 0 ? "text-brand-700" : ""}>{formatMoney(r.balance)}{r.balance < 0 ? " (advance)" : ""}</b> },
        ]}
      />
    </Card>
  );
}

async function Chart({ manage }: { manage: boolean }) {
  const rows = await prisma.ledgerAccount.findMany({ orderBy: { code: "asc" } });
  return (
    <Card>
      {manage && (
        <div className="flex justify-end border-b border-slate-100 px-4 py-2">
          <FormDialog label="New Account" icon={<Plus />} title="New ledger account">
            <EntityForm schemaKey="ledgerAccount" cols={2} fields={accountFields} defaultValues={{ active: true, openingBalance: "0" }} action={ledgerAccountAction.bind(null, null)} successMessage="Account created" />
          </FormDialog>
        </div>
      )}
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        dense
        columns={[
          { key: "c", header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
          { key: "n", header: "Account", cell: (r) => r.name },
          { key: "t", header: "Type", cell: (r) => titleCase(r.type) },
          { key: "s", header: "Sub-type", cell: (r) => r.subType },
          { key: "o", header: "Opening", align: "right", cell: (r) => formatMoney(r.openingBalance) },
          { key: "sys", header: "", cell: (r) => (r.isSystem ? <Badge tone="blue">System</Badge> : null) },
          { key: "a", header: "", cell: (r) => (r.active ? null : <Badge>Inactive</Badge>) },
          ...(manage
            ? [{ key: "e", header: "", cell: (r: (typeof rows)[number]) => (
                <FormDialog label="" icon={<Pencil />} variant="ghost" title={`Edit ${r.code} ${r.name}`}>
                  <EntityForm schemaKey="ledgerAccount" cols={2} fields={accountFields} defaultValues={toFormValues(r)} action={ledgerAccountAction.bind(null, r.id)} successMessage="Account updated" />
                </FormDialog>
              ) }]
            : []),
        ]}
      />
    </Card>
  );
}
