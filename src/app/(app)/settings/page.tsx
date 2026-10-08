import { Pencil } from "lucide-react";
import { companyAction, licenseAction, sequenceAction, settingAction } from "@/app/actions/settings";
import { FormDialog } from "@/components/forms/confirm-action";
import { EntityForm } from "@/components/forms/entity-form";
import { LicenseForm } from "@/components/forms/license-form";
import { Badge, type Tone } from "@/components/ui/badge";
import { SettingForm } from "@/components/forms/setting-form";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { LinkTabs, PageHeader, Section } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { STATE_OPTIONS, toFormValues } from "@/lib/fields";
import { str, type SP } from "@/lib/list-params";
import { formatDateTime } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { getLicenseStatus } from "@/server/license";
import { emailConfigured } from "@/server/mail";
import { lanAddresses, qrSvg } from "@/server/mobile";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("settings.view");
  const sp = await searchParams;
  const tab = str(sp, "tab") ?? "company";
  const manage = user.permissions.includes("settings.manage");
  return (
    <>
      <PageHeader title="Settings" description="Company profile, document numbering and system options" />
      <LinkTabs base="/settings" active={tab} tabs={[{ key: "company", label: "Company Profile" }, { key: "numbering", label: "Document Numbering" }, { key: "general", label: "General" }, { key: "system", label: "System & Backup" }, { key: "mobile", label: "Mobile App" }, { key: "licence", label: "Licence" }]} />
      {tab === "company" && <Company manage={manage} />}
      {tab === "numbering" && <Numbering manage={manage} />}
      {tab === "general" && <General manage={manage} />}
      {tab === "system" && <System />}
      {tab === "mobile" && <Mobile />}
      {tab === "licence" && <Licence manage={manage} />}
    </>
  );
}

async function Company({ manage }: { manage: boolean }) {
  const c = await prisma.company.findFirst();
  return (
    <Card><CardContent>
      <EntityForm
        schemaKey="company"
        fields={[
          { name: "name", label: "Company Name (on invoices)", required: true, span: 2, section: "Company" },
          { name: "legalName", label: "Legal Name" },
          { name: "gstin", label: "GSTIN" },
          { name: "pan", label: "PAN" },
          { name: "stateCode", label: "State", type: "select", options: STATE_OPTIONS, required: true },
          { name: "address", label: "Address", span: 2 },
          { name: "city", label: "City" },
          { name: "pincode", label: "PIN Code" },
          { name: "phone", label: "Phone" },
          { name: "email", label: "Email", type: "email" },
          { name: "website", label: "Website" },
          { name: "bankName", label: "Bank Name", section: "Bank details (printed on invoices)" },
          { name: "bankAccountNo", label: "Account Number" },
          { name: "bankIfsc", label: "IFSC" },
          { name: "invoiceFooter", label: "Invoice Footer Text", type: "textarea" },
        ]}
        defaultValues={toFormValues(c)}
        action={manage ? companyAction : async () => { "use server"; return { ok: false as const, error: "You do not have permission to change settings." }; }}
        successMessage="Company profile saved"
      />
    </CardContent></Card>
  );
}

async function Numbering({ manage }: { manage: boolean }) {
  const seqs = await prisma.numberSequence.findMany({ where: { NOT: { key: { contains: "@" } } }, orderBy: { name: "asc" } });
  const counters = await prisma.numberSequence.findMany({ where: { key: { contains: "@" } } });
  const year = new Date().getUTCFullYear();
  const next = (s: (typeof seqs)[number]) => {
    const c = s.includeYear ? counters.find((x) => x.key === `${s.key}@${year}`) : s;
    const n = String(c?.nextNumber ?? 1).padStart(s.padding, "0");
    return s.includeYear ? `${s.prefix}${year}-${n}` : `${s.prefix}${n}`;
  };
  return (
    <Card>
      <DataTable
        rows={seqs}
        rowKey={(s) => s.key}
        columns={[
          { key: "n", header: "Document", cell: (s) => s.name },
          { key: "p", header: "Prefix", cell: (s) => <span className="font-mono">{s.prefix}</span> },
          { key: "y", header: "Year in number", cell: (s) => (s.includeYear ? "Yes (resets yearly)" : "No") },
          { key: "pad", header: "Digits", align: "right", cell: (s) => s.padding },
          { key: "next", header: "Next Number", cell: (s) => <span className="font-mono font-medium text-brand-700">{next(s)}</span> },
          ...(manage
            ? [{ key: "e", header: "", cell: (s: (typeof seqs)[number]) => (
                <FormDialog label="" icon={<Pencil />} variant="ghost" title={`Numbering · ${s.name}`} description="Changing the prefix affects new documents only.">
                  <EntityForm schemaKey="sequence" cols={1} fields={[{ name: "prefix", label: "Prefix", required: true }, { name: "padding", label: "Number of digits", type: "number", step: "1" }, { name: "includeYear", label: "Include year", type: "checkbox", help: "Include the year (e.g. INV-2026-00001)" }]} defaultValues={{ key: s.key, prefix: s.prefix, padding: String(s.padding), includeYear: s.includeYear }} action={sequenceAction.bind(null)} successMessage="Numbering updated" />
                </FormDialog>
              ) }]
            : []),
        ]}
      />
    </Card>
  );
}

async function General({ manage }: { manage: boolean }) {
  const settings = await prisma.setting.findMany({ where: { key: { in: ["processing.lossAlertPercent", "documents.expiryWarnDays"] } } });
  return (
    <Section title="Operational thresholds">
      <CardContent className="space-y-4">
        {settings.map((s) => <SettingForm key={s.key} k={s.key} value={s.value} description={s.description ?? s.key} disabled={!manage} action={settingAction} />)}
      </CardContent>
    </Section>
  );
}

async function System() {
  const [counts, lastBackup] = await Promise.all([
    Promise.all([prisma.customer.count(), prisma.weighment.count(), prisma.customerInvoice.count(), prisma.auditLog.count(), prisma.document.count()]),
    prisma.setting.findUnique({ where: { key: "backup.last" } }),
  ]);
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Section title="System Information">
        <CardContent className="space-y-1 text-sm">
          <p>Customers: <b>{counts[0]}</b> · Weighments: <b>{counts[1]}</b> · Invoices: <b>{counts[2]}</b></p>
          <p>Audit entries: <b>{counts[3]}</b> · Documents: <b>{counts[4]}</b></p>
          <p>Email (SMTP): <b>{emailConfigured() ? "Configured" : "Not configured"}</b></p>
          <p>Upload directory: <code className="rounded bg-slate-100 px-1">{process.env.UPLOAD_DIR || "./storage/uploads"}</code></p>
          <p>Last recorded backup: <b>{lastBackup ? formatDateTime(new Date(Number(lastBackup.value))) : "Not recorded"}</b></p>
        </CardContent>
      </Section>
      <Section title="Backup & Restore">
        <CardContent className="space-y-2 text-sm text-slate-600">
          <p>Back up both the PostgreSQL database and the uploads directory. From the application folder on the server:</p>
          <pre className="overflow-x-auto rounded-lg bg-navy-900 p-3 text-xs text-brand-200">{`npm run backup            # writes backups/waste_erp_<timestamp>.dump + uploads archive
npm run restore -- backups/waste_erp_<timestamp>.dump`}</pre>
          <p>Schedule the backup daily (cron) and copy the files off the server. Full instructions are in <b>DATABASE.md</b> and <b>DEPLOYMENT.md</b>.</p>
        </CardContent>
      </Section>
    </div>
  );
}

const LICENCE_BADGE: Record<string, [string, Tone]> = {
  trial: ["Trial", "blue"],
  active: ["Active", "green"],
  expiring: ["Expiring soon", "amber"],
  grace: ["Expired · grace period", "red"],
  expired: ["Expired · view-only", "red"],
  invalid: ["Invalid key", "red"],
  mismatch: ["GSTIN mismatch", "red"],
  clock: ["Check system date", "red"],
};

async function Licence({ manage }: { manage: boolean }) {
  const s = await getLicenseStatus();
  const [label, tone] = LICENCE_BADGE[s.state];
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Section title="Licence Status">
        <CardContent className="space-y-2 text-sm">
          <p><Badge tone={tone}>{label}</Badge></p>
          <p>{s.message}</p>
          <dl className="grid grid-cols-[9rem_1fr] gap-y-1 pt-2">
            <dt className="text-slate-500">Licensed to</dt><dd className="font-medium">{s.licensee ?? "—"}</dd>
            <dt className="text-slate-500">GSTIN</dt><dd>{s.gstin ?? "Any"}</dd>
            <dt className="text-slate-500">Valid until</dt><dd>{s.expires ?? "—"}</dd>
            <dt className="text-slate-500">Active users allowed</dt><dd>{s.users ?? "Unlimited"}</dd>
          </dl>
        </CardContent>
      </Section>
      <Section title="Install or Renew">
        <CardContent className="space-y-3 text-sm text-slate-600">
          <p>Paste the licence key you received from your vendor. A renewal key replaces the current one; your data is not affected.</p>
          {manage ? <LicenseForm action={licenseAction} /> : <p>Only an administrator can install a licence key.</p>}
        </CardContent>
      </Section>
    </div>
  );
}

async function Mobile() {
  const addresses = lanAddresses(process.env.PORT || "3000");
  const qrs = await Promise.all(addresses.map((a) => qrSvg(`${a}/mobile`)));
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Section title="Install on phones">
        <CardContent className="space-y-3 text-sm text-slate-600">
          {addresses.length === 0 && <p>This computer is not connected to a network, so phones cannot reach it.</p>}
          {addresses.map((a, i) => (
            <div key={a} className="flex flex-wrap items-center gap-4">
              <div className="size-40 shrink-0 rounded-lg border border-slate-200 p-1" dangerouslySetInnerHTML={{ __html: qrs[i] }} />
              <div>
                <p>Scan with the phone camera, or open in the phone browser:</p>
                <p className="mt-1 font-mono text-base font-semibold text-navy-800">{a}/mobile</p>
                <p className="mt-2">Server address to type in the app: <b className="font-mono">{a.replace("http://", "")}</b></p>
              </div>
            </div>
          ))}
        </CardContent>
      </Section>
      <Section title="If phones cannot connect">
        <CardContent className="space-y-2 text-sm text-slate-600">
          <ol className="list-decimal space-y-1 pl-5">
            <li>The phone must be on the <b>same Wi-Fi</b> as this computer.</li>
            <li>On this computer, double-click <b>ALLOW-PHONES.bat</b> once and click <b>Yes</b>. It opens port 3000 in Windows Firewall.</li>
            <li>Keep this computer on and GreenCycle running (START-WINDOWS.bat) while staff use their phones.</li>
            <li>If the address above changes after a router restart, ask your network person to give this computer a <b>fixed IP address</b>, then update the address in each app (your name → App settings).</li>
          </ol>
          <p className="pt-2">Android: the app supports camera photos, GPS location, downloads and printing. iPhone: use Safari → Share → Add to Home Screen.</p>
        </CardContent>
      </Section>
    </div>
  );
}
