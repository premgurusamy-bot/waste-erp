import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, download } from "../api";
import { useAuth } from "../auth";
import { bytes, dateTime, displayDate, money } from "../format";
import { Badge, Field, Loading, Modal, PageHead, Tabs, TypedConfirm, useAction, useLoad, useToast, clearOptionCache } from "../components/ui";

declare global {
  interface Window { grlDesktop?: { openPath: (which: string) => Promise<string>; backupDir: () => Promise<string> } }
}

const SHEET_KEYS: [string, string][] = [
  ["customers", "Customers"], ["transporters", "Transporters"], ["vehicles", "Vehicles"], ["drivers", "Drivers"], ["loadingPoints", "Loading points"], ["deliveryPoints", "Delivery points"],
  ["freight", "Freight rates"], ["trips", "Trips"], ["tripItems", "Trip items"], ["expenses", "Expenses"], ["invoices", "Invoices"], ["invoiceItems", "Invoice items"], ["receipts", "Customer receipts"],
  ["settlements", "Settlements"], ["payments", "Transporter payments"], ["documents", "Documents"], ["vehicleDocuments", "Vehicle documents"], ["driverDocuments", "Driver documents"],
  ["targets", "Targets"], ["settings", "Settings"], ["company", "Company"],
];

function Health({ h }: { h: any }) {
  return (
    <div className="card">
      <div className="spread"><h2>BACKUP STATUS</h2><span className="muted small">Folder: <span className="mono">{h.location}</span></span></div>
      <div className="health">
        <div>Last Backup<b>{h.lastBackupAt ? dateTime(h.lastBackupAt) : "Never"}</b></div>
        <div>Backup Status<b><span className={`dot ${h.status}`} />{h.statusText}</b></div>
        <div>Last Restore Test<b>{h.lastRestoreTestAt ? displayDate(h.lastRestoreTestAt.slice(0, 10)) : "Never"}</b></div>
        <div>Backup File Count<b>{h.backupFileCount}</b></div>
        <div>Database Backup<b>{h.databaseBackupAvailable ? "AVAILABLE" : "NOT AVAILABLE"}</b></div>
        <div>Excel Backup<b>{h.excelBackupAvailable ? "AVAILABLE" : "NOT AVAILABLE"}</b></div>
        <div>Data Safety<b className={h.dataSafety === "PROTECTED" ? "pos" : "neg"}>{h.dataSafety}</b></div>
      </div>
      {h.reminder && <div className={`alert ${h.reminderLevel === "WARNING" ? "amber" : "red"}`} style={{ marginTop: 12, marginBottom: 0 }}>{h.reminder}</div>}
    </div>
  );
}

function FilePicker({ onPicked, title }: { onPicked: (token: string, fileName: string) => void; title: string }) {
  const input = useRef<HTMLInputElement>(null);
  const files = useLoad(() => api.get("/backup/files"), []);
  const { busy, run } = useAction();
  const upload = async (f?: File) => {
    if (!f) return;
    const r = await run(() => api.upload("/restore/upload", f));
    if (r) onPicked(r.token, r.fileName);
  };
  const pick = async (fileName: string) => {
    const r = await run(() => api.post("/restore/stage-existing", { fileName }));
    if (r) onPicked(r.token, r.fileName);
  };
  return (
    <div className="stack">
      <p>{title}</p>
      <button className="btn-primary btn-lg" disabled={busy} onClick={() => input.current?.click()}>📂 Choose Excel file (.xlsx) from this computer / USB drive</button>
      <input ref={input} type="file" accept=".xlsx" hidden onChange={(e) => upload(e.target.files?.[0])} />
      {busy && <div className="muted">Reading file…</div>}
      <div className="muted small">…or pick a backup already in the backup folder:</div>
      <div className="table-wrap" style={{ maxHeight: 260 }}><table><tbody>
        {(files.data ?? []).filter((f: any) => f.fileName.endsWith(".xlsx")).slice(0, 60).map((f: any) => (
          <tr key={f.folder + f.fileName}><td className="mono">{f.fileName}</td><td className="muted small">{f.folder}</td><td className="small">{dateTime(f.modifiedAt)}</td><td><button className="btn-sm" disabled={busy} onClick={() => pick(f.fileName)}>Use</button></td></tr>
        ))}
      </tbody></table></div>
    </div>
  );
}

export function PlanView({ plan, forImport }: { plan: any; forImport?: boolean }) {
  const v = plan.verification;
  const info = plan.info ?? {};
  const counts = (k: string) => plan.sheets.find((s: any) => s.key === k)?.inFile ?? 0;
  return (
    <div className="stack">
      {v.isErpBackup ? (
        <div className={`alert ${v.checksumOk && v.versionOk ? "green" : "red"}`}>
          <b>{v.checksumOk ? "✔ BACKUP VERIFIED" : "✖ VERIFICATION FAILED"}</b> {v.message}
          {v.damagedSheets?.length > 0 && <div className="small">Changed / damaged sheets: {v.damagedSheets.join(", ")}</div>}
        </div>
      ) : forImport ? null : <div className="alert amber">{v.message}</div>}
      {v.isErpBackup && (
        <div className="health">
          <div>BACKUP DATE<b>{info["Backup Date"]} {info["Backup Time"]}</b></div>
          <div>COMPANY<b>{info["Company Name"]}</b></div>
          <div>APP / SCHEMA<b>{info["Application Version"]} / {info["Schema Version"]}</b></div>
          <div>CUSTOMERS<b>{counts("customers").toLocaleString("en-IN")}</b></div>
          <div>TRANSPORTERS<b>{counts("transporters").toLocaleString("en-IN")}</b></div>
          <div>VEHICLES<b>{counts("vehicles").toLocaleString("en-IN")}</b></div>
          <div>DRIVERS<b>{counts("drivers").toLocaleString("en-IN")}</b></div>
          <div>TRIPS<b>{counts("trips").toLocaleString("en-IN")}</b></div>
          <div>EXPENSES<b>{counts("expenses").toLocaleString("en-IN")}</b></div>
          <div>INVOICES<b>{counts("invoices").toLocaleString("en-IN")}</b></div>
          <div>PAYMENTS<b>{(counts("receipts") + counts("payments")).toLocaleString("en-IN")}</b></div>
        </div>
      )}
      <h3>DATA TO IMPORT</h3>
      <div className="table-wrap"><table>
        <thead><tr><th>Sheet</th><th className="num">In file</th><th className="num">New records</th><th className="num">Updated records</th><th className="num">Duplicate (unchanged)</th><th className="num">Invalid records</th>{plan.mode === "FULL" && <th className="num">Will be removed</th>}</tr></thead>
        <tbody>{plan.sheets.filter((s: any) => s.selected).map((s: any) => (
          <tr key={s.key}><td>{s.name}</td><td className="num">{s.inFile}</td><td className="num">{s.newRecords}</td><td className="num">{s.updatedRecords}</td><td className="num">{s.duplicateRecords}</td><td className={`num ${s.invalidRecords ? "neg" : ""}`}>{s.invalidRecords}</td>{plan.mode === "FULL" && <td className={`num ${s.toRemove ? "neg" : ""}`}>{s.toRemove}</td>}</tr>
        ))}</tbody>
      </table></div>
      {plan.blockers.length > 0 && <div className="alert red" style={{ display: "block" }}><b>Cannot continue:</b><ul style={{ margin: "6px 0 0" }}>{plan.blockers.map((b: string) => <li key={b}>{b}</li>)}</ul></div>}
      {plan.issues.length > 0 && (
        <>
          <h3>Errors and warnings ({plan.errorCount} errors, {plan.warningCount} warnings)</h3>
          <div className="table-wrap" style={{ maxHeight: 300 }}><table>
            <thead><tr><th>Sheet</th><th>Row</th><th>Record ID</th><th>Field</th><th>Error</th><th>Suggested fix</th></tr></thead>
            <tbody>{plan.issues.slice(0, 500).map((i: any, n: number) => <tr key={n}><td>{i.sheet}</td><td>{i.row ?? ""}</td><td className="mono">{i.recordId}</td><td>{i.field}</td><td className={i.severity === "ERROR" ? "neg" : ""}>{i.error}</td><td>{i.suggestedFix}</td></tr>)}</tbody>
          </table></div>
        </>
      )}
    </div>
  );
}

export function ResultView({ r, onRollback }: { r: any; onRollback?: () => void }) {
  if (!r.ok) {
    return (
      <div className="stack">
        <div className="alert red" style={{ display: "block" }}><b style={{ fontSize: 16 }}>{r.status}</b><div>{r.message}</div></div>
        {r.plan && <PlanView plan={r.plan} />}
        {r.errorReport && <button onClick={() => download(`/restore/${r.restoreId}/errors`)}>Download RESTORE_ERRORS.xlsx</button>}
        {r.canRollback && onRollback && <button className="btn-danger" onClick={onRollback}>ROLLBACK to the pre-restore backup</button>}
      </div>
    );
  }
  const res = r.result;
  return (
    <div className="stack">
      <div className="alert green" style={{ display: "block" }}><b style={{ fontSize: 18 }}>{r.status}</b>{r.result.dryRun && <div>Everything was restored inside a test transaction and then undone. Your data was not changed.</div>}</div>
      <h3>Records {res.dryRun ? "that would be restored" : "restored"}</h3>
      <div className="table-wrap"><table><thead><tr><th>Sheet</th><th className="num">Expected</th><th className="num">In database</th><th>Check</th></tr></thead>
        <tbody>{res.counts.map((c: any) => <tr key={c.sheet}><td>{c.label}</td><td className="num">{c.expected.toLocaleString("en-IN")}</td><td className="num">{c.actual.toLocaleString("en-IN")}</td><td>{c.ok ? <Badge s="OK" /> : <Badge s="FAILED" />}</td></tr>)}</tbody></table></div>
      <h3>Financial verification</h3>
      <div className="table-wrap"><table><thead><tr><th>Total</th><th className="num">In backup</th><th className="num">After restore</th><th>Match</th></tr></thead>
        <tbody>{res.financialCheck.map((f: any) => <tr key={f.field}><td>{f.label}</td><td className="num">{f.backup === null ? "—" : f.field === "totalTrips" ? f.backup : money(f.backup, 2)}</td><td className="num">{f.field === "totalTrips" ? f.restored : money(f.restored, 2)}</td><td>{f.ok === null ? <span className="muted small">n/a (merge/import)</span> : f.ok ? <Badge s="OK" /> : <Badge s="FAILED" />}</td></tr>)}</tbody></table></div>
      {r.documents && (r.documents.recovered > 0 || r.documents.missing > 0) && <div className="alert amber">Document files: {r.documents.recovered} recovered from Backup/Documents, {r.documents.missing} not found on this computer (copy your old Backup/Documents folder here to restore them).</div>}
      {r.preRestoreBackup && <div className="muted small">Safety backup made before restoring: <span className="mono">{r.preRestoreBackup}</span></div>}
      {r.errorReport && <button onClick={() => download(`/restore/${r.restoreId}/errors`)}>Download RESTORE_ERRORS.xlsx</button>}
      {!res.dryRun && onRollback && <button className="btn-danger" onClick={onRollback}>ROLLBACK (undo this restore)</button>}
    </div>
  );
}

function RestoreWizard({ initialMode, initialFile, onClose, onDone }: { initialMode: "FULL" | "MERGE" | "IMPORT"; initialFile?: { token: string; fileName: string }; onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<"file" | "mode" | "preview" | "result">(initialFile ? "mode" : "file");
  const [file, setFile] = useState<{ token: string; fileName: string } | null>(initialFile ?? null);
  const [mode, setMode] = useState(initialMode);
  const [sheets, setSheets] = useState<string[]>(["customers"]);
  const [plan, setPlan] = useState<any>(null);
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [confirmFull, setConfirmFull] = useState(false);
  const [rollbackId, setRollbackId] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  const doPreview = async (m = mode, skip = skipInvalid) => {
    const r = await run(() => api.post("/restore/preview", { token: file!.token, mode: m, sheets: m === "IMPORT" ? sheets : undefined, skipInvalid: skip }));
    if (r) { setPlan(r.plan); setStep("preview"); }
  };
  const execute = async (confirm: any) => {
    const r = await run(() => api.post("/restore/run", { token: file!.token, mode, sheets: mode === "IMPORT" ? sheets : undefined, skipInvalid, confirm }));
    setConfirmFull(false);
    if (r) { setResult(r); setStep("result"); clearOptionCache(); onDone(); toast(r.ok ? "ok" : "err", r.status); }
  };
  const rollback = async () => {
    const r = await run(() => api.post(`/restore/${rollbackId}/rollback`, { confirm: "ROLLBACK" }));
    setRollbackId(null);
    if (r) { setResult({ ...r, status: r.ok ? "ROLLBACK COMPLETE - data is back as it was before the restore" : r.status }); clearOptionCache(); onDone(); }
  };
  const title = mode === "FULL" ? "RESTORE FROM EXCEL (FULL RESTORE)" : mode === "MERGE" ? "RESTORE FROM EXCEL (MERGE)" : "IMPORT DATA";
  return (
    <Modal wide title={title} onClose={onClose} footer={
      step === "mode" ? <><button onClick={() => setStep("file")}>Back</button><button className="btn-primary" disabled={busy || (mode === "IMPORT" && !sheets.length)} onClick={() => doPreview()}>{busy ? "Checking every sheet…" : "Check file & preview"}</button></>
      : step === "preview" ? <><button onClick={() => setStep("mode")}>Back</button>
          {plan?.needsSkipInvalidConfirmation && <label className="check"><input type="checkbox" checked={skipInvalid} onChange={(e) => { setSkipInvalid(e.target.checked); doPreview(mode, e.target.checked); }} /> Skip the {plan.errorCount} invalid record(s) and import the rest</label>}
          <button className={mode === "FULL" ? "btn-danger" : "btn-primary"} disabled={busy || !plan?.canProceed} onClick={() => (mode === "FULL" ? setConfirmFull(true) : window.confirm("A safety backup of the current data is made first. Import now?") && execute(true))}>{busy ? "Working…" : mode === "FULL" ? "Restore (replace current data)" : "Import"}</button></>
      : <button onClick={onClose}>Close</button>
    }>
      {step === "file" && <FilePicker title={mode === "IMPORT" ? "Choose the Excel file to import (an ERP backup or a filled-in import template)." : "Choose the backup file, for example GRL_ERP_BACKUP_2026-10-08_13-30-00.xlsx"} onPicked={(token, fileName) => { setFile({ token, fileName }); setStep("mode"); }} />}
      {step === "mode" && file && (
        <div className="stack">
          <div>File: <b className="mono">{file.fileName}</b></div>
          <label className="check"><input type="radio" checked={mode === "FULL"} onChange={() => setMode("FULL")} /> <b>FULL RESTORE</b> — replace the database with this backup (a backup of the current data is made automatically first)</label>
          <label className="check"><input type="radio" checked={mode === "MERGE"} onChange={() => setMode("MERGE")} /> <b>MERGE</b> — add missing records and update existing ones. Nothing is ever deleted.</label>
          <label className="check"><input type="radio" checked={mode === "IMPORT"} onChange={() => setMode("IMPORT")} /> <b>IMPORT ONLY</b> — import only the sheets you choose (e.g. only Customers)</label>
          {mode === "IMPORT" && (
            <div className="card" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 6 }}>
              {SHEET_KEYS.map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={sheets.includes(k)} onChange={(e) => setSheets(e.target.checked ? [...sheets, k] : sheets.filter((x) => x !== k))} />{l}</label>)}
            </div>
          )}
        </div>
      )}
      {step === "preview" && plan && <PlanView plan={plan} />}
      {step === "result" && result && <ResultView r={result} onRollback={result.restoreId && (result.preRestoreBackup || result.canRollback) ? () => setRollbackId(result.restoreId) : undefined} />}
      {confirmFull && <TypedConfirm title="THIS WILL REPLACE CURRENT DATABASE DATA" word="REPLACE" busy={busy} onClose={() => setConfirmFull(false)} onConfirm={() => execute("REPLACE")}
        message={<><p><b>All current business data will be replaced by the backup.</b></p><p>Before anything changes the ERP makes a PRE-RESTORE backup (Excel + database) so you can ROLL BACK. Users and the licence are not affected.</p></>} />}
      {rollbackId && <TypedConfirm title="Roll back this restore?" word="ROLLBACK" busy={busy} onClose={() => setRollbackId(null)} onConfirm={rollback} message="The data will be put back exactly as it was before the restore, from the PRE-RESTORE backup." />}
    </Modal>
  );
}

function VerifyModal({ onClose }: { onClose: () => void }) {
  const [res, setRes] = useState<any>(null);
  const { busy, run } = useAction();
  return (
    <Modal wide title="VERIFY BACKUP" onClose={onClose} footer={<button onClick={onClose}>Close</button>}>
      {!res ? <FilePicker title="Choose a backup to verify. The checksum of every sheet is recalculated and compared." onPicked={async (token) => { const r = await run(() => api.post("/backup/verify", { token })); if (r) setRes(r); }} /> : (
        <div className="stack">
          <div className={`alert ${res.verification.checksumOk ? "green" : "red"}`}><b>{res.verification.checksumOk ? "✔ VERIFIED" : "✖ CORRUPTED / MODIFIED"}</b> {res.verification.message}</div>
          {res.verification.damagedSheets?.length > 0 && <div className="alert red">Sheets that do not match: {res.verification.damagedSheets.join(", ")}</div>}
          <dl className="kv">{["Backup ID", "Backup Date", "Backup Time", "Company Name", "Application Version", "Schema Version", "Total Records", "Created By", "Backup Type"].map((k) => [<dt key={k}>{k}</dt>, <dd key={k + "v"}>{res.info[k]}</dd>])}</dl>
          <div className="table-wrap" style={{ maxHeight: 260 }}><table><tbody>{Object.entries(res.counts).map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{String(v)}</td></tr>)}</tbody></table></div>
        </div>
      )}
      {busy && <div className="muted">Verifying…</div>}
    </Modal>
  );
}

export function BackupPage() {
  const { can } = useAuth();
  const [sp] = useSearchParams();
  const health = useLoad(() => api.get("/backup/health"), []);
  const history = useLoad(() => api.get("/backup/history"), []);
  const restores = useLoad(() => (can("backup.restore") ? api.get("/restore/history") : Promise.resolve([])), []);
  const files = useLoad(() => api.get("/backup/files"), []);
  const [tab, setTab] = useState<"history" | "restores" | "files" | "retention">("history");
  const [wizard, setWizard] = useState<null | "FULL" | "IMPORT">(null);
  const [wizardFile, setWizardFile] = useState<{ token: string; fileName: string } | undefined>();
  const [verify, setVerify] = useState(false);
  const [done, setDone] = useState<any>(null);
  const [rollbackId, setRollbackId] = useState<string | null>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  const reloadAll = () => { health.reload(); history.reload(); restores.reload(); files.reload(); };
  const backupNow = async (type?: string) => {
    const r = await run(() => api.post("/backup/now", { type }));
    if (r) { setDone({ title: "BACKUP COMPLETED", lines: [`File: ${r.fileName}`, `Records: ${r.totalRecords.toLocaleString("en-IN")}`, `Verified: ${r.verified ? "YES (checksum matches)" : "NO"}`, r.dbDump || r.dbSnapshot ? `Database backup: ${(r.dbDump ?? r.dbSnapshot).split(/[\\/]/).pop()}` : ""], location: r.location, download: r.fileName }); reloadAll(); }
  };
  const emergency = async () => {
    const r = await run(() => api.post("/backup/emergency"));
    if (r) { setDone({ title: "BACKUP COMPLETED", lines: [`Excel backup: ${r.excel.fileName} (${r.excel.verified ? "VERIFIED" : "NOT VERIFIED"})`, `Records: ${r.excel.totalRecords.toLocaleString("en-IN")}`, `Database backup: ${(r.excel.dbDump ?? r.excel.dbSnapshot ?? "").split(/[\\/]/).pop()}`, `Document manifest: ${r.documents.total} document(s), ${r.documents.copied} copied`, `Settings backup: ${r.settingsFile.split(/[\\/]/).pop()}`], location: r.location, download: r.excel.fileName }); reloadAll(); }
  };
  const exportAll = async () => {
    const r = await run(() => api.post("/backup/export-all"));
    if (r) { setDone({ title: "EXPORT COMPLETED", lines: [`File: ${r.fileName}`, "Contains /Excel, /Database, /Documents, /Manifest and /Logs"], location: r.location, download: r.fileName }); reloadAll(); }
  };
  const testRestore = async () => {
    const r = await run(() => api.post("/restore/test", {}));
    if (r) { toast(r.ok ? "ok" : "err", r.status); setDone({ title: r.status, result: r }); reloadAll(); }
  };
  const openFolder = async (which: string) => {
    if (window.grlDesktop) { await window.grlDesktop.openPath(which); return; }
    const r = await run(() => api.post("/backup/open-folder", { which }));
    if (r) toast("ok", r.opened ? `Opened ${r.path}` : `Backup folder on the server computer: ${r.path}`);
  };
  const doRollback = async () => {
    const r = await run(() => api.post(`/restore/${rollbackId}/rollback`, { confirm: "ROLLBACK" }));
    setRollbackId(null);
    if (r) { toast(r.ok ? "ok" : "err", r.ok ? "Rolled back" : r.status); reloadAll(); }
  };
  return (
    <>
      <PageHead title="Backup & Restore" sub="Your business data must never be lost. Backups are separate files outside the program folder." />
      {sp.get("firstRun") && <div className="alert blue"><b>New installation.</b> If you have a backup from your old computer, click <b>RESTORE FROM EXCEL</b> and choose the latest GRL_ERP_BACKUP file.</div>}
      {health.data ? <Health h={health.data} /> : <Loading error={health.error} />}
      <div className="card">
        <button className="emergency" disabled={busy} onClick={emergency}>⛑ EMERGENCY BACKUP</button>
        <p className="muted small" style={{ textAlign: "center", margin: "6px 0 14px" }}>Excel backup + database backup + document manifest + settings + verification, in one click.</p>
        <div className="backup-buttons">
          <button className="btn-primary" disabled={busy} onClick={() => backupNow()}>BACKUP NOW</button>
          {can("backup.restore") && <button className="btn-gold" disabled={busy} onClick={() => setWizard("FULL")}>RESTORE FROM EXCEL</button>}
          <button disabled={busy} onClick={exportAll}>EXPORT ALL DATA (.zip)</button>
          {can("backup.restore") && <button disabled={busy} onClick={() => setWizard("IMPORT")}>IMPORT DATA</button>}
          <button disabled={busy} onClick={() => setVerify(true)}>VERIFY BACKUP</button>
          <button disabled={busy} onClick={testRestore}>RESTORE TEST (no changes)</button>
          <button disabled={busy} onClick={() => openFolder("root")}>OPEN BACKUP FOLDER</button>
          <button disabled={busy} onClick={() => openFolder("database")}>OPEN DATABASE BACKUP FOLDER</button>
          <button disabled={busy} onClick={() => backupNow("PRE-UPDATE")}>BACKUP BEFORE UPDATE</button>
          {can("backup.restore") && <button disabled={busy} onClick={() => download("/backup/import-template")}>Download import template</button>}
        </div>
        {busy && <div className="alert blue" style={{ marginTop: 12 }}>Working… please keep the ERP open.</div>}
        <p className="muted small">Make a backup before reinstalling the application, updating the ERP, changing the database, restoring data or moving to another computer. Copy the Backup folder to a USB drive or Google Drive regularly.</p>
      </div>

      <DriveCard onRestore={(f) => { setWizardFile(f); setWizard("FULL"); }} onChanged={reloadAll} />

      <div className="card">
        <Tabs tabs={[{ key: "history", label: "Backup history" }, { key: "restores", label: "Restore history" }, { key: "files", label: "Files on disk" }, { key: "retention", label: "Retention" }]} value={tab} onChange={setTab} />
        {tab === "history" && (!history.data ? <Loading /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Backup Date</th><th>Backup Type</th><th>File Name</th><th className="num">Records</th><th>Status</th><th className="hide-mobile">Created By</th><th>Verified</th><th>Google Drive</th><th></th></tr></thead>
            <tbody>{history.data.map((b: any) => (
              <tr key={b.id}><td className="nowrap">{dateTime(b.createdAt)}</td><td><Badge s={b.type} /></td><td className="mono">{b.fileName}</td><td className="num">{b.records.toLocaleString("en-IN")}</td><td><Badge s={b.status} />{b.message && <div className="neg small">{b.message}</div>}</td><td className="hide-mobile">{b.createdBy}</td><td>{b.verified ? "✔ " + dateTime(b.verifiedAt) : "—"}</td>
                <td>{b.driveStatus === "NONE" ? <span className="muted small">—</span> : <span title={b.driveError ?? ""}><Badge s={b.driveStatus === "UPLOADED" ? "UPLOADED" : b.driveStatus} /></span>}</td>
                <td>{["VERIFIED", "SUCCESS"].includes(b.status) && <button className="btn-sm" onClick={() => download(`/backup/download/${encodeURIComponent(b.fileName)}`)}>Download</button>}</td></tr>
            ))}</tbody>
          </table></div>
        ))}
        {tab === "restores" && (!restores.data ? <Loading /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>File</th><th>Mode</th><th>Status</th><th className="hide-mobile">By</th><th>Message</th><th></th></tr></thead>
            <tbody>{restores.data.map((r: any) => (
              <tr key={r.id}><td className="nowrap">{dateTime(r.startedAt)}</td><td className="mono">{r.fileName}</td><td>{r.dryRun ? "TEST" : r.mode}</td><td><Badge s={r.status} />{r.rolledBack && <Badge s="ROLLED BACK" />}</td><td className="hide-mobile">{r.createdBy}</td><td className="small">{r.message}</td>
                <td className="nowrap">{(r.summary as any)?.errorReport && <button className="btn-sm" onClick={() => download(`/restore/${r.id}/errors`)}>Errors</button>} {!r.dryRun && r.preRestoreBackup && !r.rolledBack && can("backup.restore") && <button className="btn-sm btn-danger" onClick={() => setRollbackId(r.id)}>Rollback</button>}</td></tr>
            ))}</tbody>
          </table></div>
        ))}
        {tab === "files" && (!files.data ? <Loading /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Folder</th><th>File</th><th className="num">Size</th><th>Modified</th><th></th></tr></thead>
            <tbody>{files.data.map((f: any) => <tr key={f.folder + f.fileName}><td>{f.folder}</td><td className="mono">{f.fileName}</td><td className="num">{bytes(f.sizeBytes)}</td><td>{dateTime(f.modifiedAt)}</td><td><button className="btn-sm" onClick={() => download(`/backup/download/${encodeURIComponent(f.fileName)}`)}>Download</button></td></tr>)}</tbody>
          </table></div>
        ))}
        {tab === "retention" && <Retention onDone={reloadAll} />}
      </div>

      {wizard && <RestoreWizard initialMode={wizard} initialFile={wizardFile} onClose={() => { setWizard(null); setWizardFile(undefined); }} onDone={reloadAll} />}
      {verify && <VerifyModal onClose={() => { setVerify(false); reloadAll(); }} />}
      {rollbackId && <TypedConfirm title="Roll back this restore?" word="ROLLBACK" busy={busy} onClose={() => setRollbackId(null)} onConfirm={doRollback} message="The data will be put back exactly as it was before that restore, from its PRE-RESTORE backup. (A safety backup of the current data is made first.)" />}
      {done && (
        <Modal title={done.title} onClose={() => setDone(null)} wide={!!done.result} footer={<>{done.download && <button onClick={() => download(`/backup/download/${encodeURIComponent(done.download)}`)}>Download a copy</button>}<button className="btn-primary" onClick={() => setDone(null)}>OK</button></>}>
          {done.result ? <ResultView r={done.result} /> : (
            <div className="stack">
              <div className="alert green"><b style={{ fontSize: 18 }}>✔ {done.title}</b></div>
              {done.lines.filter(Boolean).map((l: string) => <div key={l}>{l}</div>)}
              <div>Backup location: <span className="mono">{done.location}</span></div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

function Retention({ onDone }: { onDone: () => void }) {
  const plan = useLoad(() => api.get("/backup/retention"), []);
  const { can } = useAuth();
  const [sel, setSel] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const { busy, run } = useAction();
  if (!plan.data) return <Loading error={plan.error} />;
  const p = plan.data;
  return (
    <div className="stack">
      <div>Policy: keep the last <b>{p.keepDaily}</b> daily backups ({p.dailyCount} now) and the last <b>{p.keepMonthly}</b> monthly backups ({p.monthlyCount} now). Change it in Settings → Application.</div>
      <div className="alert blue">Backups are <b>never deleted automatically</b>. Files beyond the policy are listed here; you decide whether to delete them. PRE-RESTORE backups are always kept.</div>
      {p.candidates.length === 0 ? <div className="muted">Nothing to clean up.</div> : (
        <>
          <div className="table-wrap" style={{ maxHeight: 300 }}><table><tbody>
            {p.candidates.map((c: any) => <tr key={c.fileName}><td><input type="checkbox" checked={sel.includes(c.fileName)} onChange={(e) => setSel(e.target.checked ? [...sel, c.fileName] : sel.filter((x) => x !== c.fileName))} aria-label={c.fileName} /></td><td className="mono">{c.fileName}</td><td>{c.folder}</td><td>{dateTime(c.modifiedAt)}</td><td className="num">{bytes(c.sizeBytes)}</td></tr>)}
          </tbody></table></div>
          {can("backup.restore") && <div className="row"><button onClick={() => setSel(p.candidates.map((c: any) => c.fileName))}>Select all</button><button className="btn-danger" disabled={!sel.length} onClick={() => setConfirm(true)}>Delete {sel.length} selected file(s)</button></div>}
        </>
      )}
      {confirm && <TypedConfirm title="Delete old backup files?" word="DELETE" busy={busy} onClose={() => setConfirm(false)} message={`${sel.length} backup file(s) will be permanently deleted from the backup folder.`}
        onConfirm={() => run(() => api.post("/backup/retention/delete", { files: sel, confirm: "DELETE" }), "Deleted").then(() => { setConfirm(false); setSel([]); plan.reload(); onDone(); })} />}
    </div>
  );
}

function DriveCard({ onRestore, onChanged }: { onRestore: (f: { token: string; fileName: string }) => void; onChanged: () => void }) {
  const { can } = useAuth();
  const st = useLoad(() => api.get("/gdrive/status"), []);
  const [setup, setSetup] = useState(false);
  const [client, setClient] = useState({ clientId: "", clientSecret: "" });
  const [list, setList] = useState<any>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  if (!st.data) return <div className="card"><h2>GOOGLE DRIVE</h2><Loading error={st.error} /></div>;
  const s = st.data;
  const onServer = ["localhost", "127.0.0.1"].includes(location.hostname);
  const connect = async () => {
    const r = await run(() => api.post("/gdrive/connect"));
    if (!r) return;
    window.open(r.url, "_blank", "noopener");
    toast("ok", "Sign in with your Google account in the browser, then come back here.");
    const until = Date.now() + 5 * 60_000;
    const poll = setInterval(async () => {
      const x = await api.get("/gdrive/status").catch(() => null);
      if (x?.connected || Date.now() > until) { clearInterval(poll); st.reload(); onChanged(); if (x?.connected) toast("ok", `Google Drive connected: ${x.email}`); }
    }, 3000);
  };
  const toggleAuto = (on: boolean) => run(() => api.put("/settings", { "gdrive.autoUpload": on ? "true" : "false" }), on ? "Automatic upload ON" : "Automatic upload OFF").then(st.reload);
  const restoreFrom = async (f: any) => {
    const r = await run(() => api.post("/gdrive/stage", { fileId: f.id }));
    if (r) onRestore({ token: r.token, fileName: r.fileName });
  };
  return (
    <div className="card">
      <div className="spread">
        <h2>GOOGLE DRIVE (off-site copy)</h2>
        {s.connected ? <Badge s="CONNECTED" /> : <Badge s="NOT CONNECTED" />}
      </div>
      {s.connected ? (
        <div className="stack">
          <div className="health">
            <div>Google account<b>{s.email}</b></div>
            <div>Last upload<b>{s.lastUploadAt ? dateTime(s.lastUploadAt) : "Not yet"}</b></div>
            <div>Waiting / failed uploads<b className={s.pending ? "neg" : ""}>{s.pending}</b></div>
            <div>Automatic upload<b>{s.autoUpload ? "ON" : "OFF"}</b></div>
          </div>
          <div className="muted small">Every verified backup (Excel + database), every full export and all document photos are copied to <b>My Drive › G Road Lines ERP Backup</b>. If the internet is down, uploads are retried every hour.</div>
          <div className="row">
            <button className="btn-primary" disabled={busy} onClick={() => run(() => api.post("/gdrive/sync"), "").then((r: any) => { if (r) toast(r.failed ? "err" : "ok", `Uploaded ${r.uploaded} backup(s), ${r.documents?.uploaded ?? 0} document(s)${r.failed ? `; ${r.failed} failed` : ""}`); st.reload(); onChanged(); })}>Upload now</button>
            <button disabled={busy} onClick={() => run(() => api.get("/gdrive/files")).then((r) => r && setList(r))}>Backups in Google Drive</button>
            {s.folderUrl && <a className="btn" href={s.folderUrl} target="_blank" rel="noopener noreferrer">Open folder in Drive</a>}
            {can("settings.edit") && <button disabled={busy} onClick={() => toggleAuto(!s.autoUpload)}>{s.autoUpload ? "Turn automatic upload OFF" : "Turn automatic upload ON"}</button>}
            {can("backup.restore") && <button className="btn-danger" disabled={busy} onClick={() => confirm("Disconnect Google Drive? Files already in Drive are kept.") && run(() => api.post("/gdrive/disconnect"), "Disconnected").then(st.reload)}>Disconnect</button>}
          </div>
          {list && (
            <div className="table-wrap" style={{ maxHeight: 320 }}><table>
              <thead><tr><th>Backup in Google Drive</th><th>Uploaded</th><th className="num">Size</th><th></th></tr></thead>
              <tbody>
                {[...list.excel, ...list.exports].length === 0 && <tr><td colSpan={4} className="empty">No backups in Drive yet</td></tr>}
                {list.excel.map((f: any) => <tr key={f.id}><td className="mono">{f.name}</td><td>{dateTime(f.createdTime)}</td><td className="num">{bytes(Number(f.size ?? 0))}</td><td>{can("backup.restore") && <button className="btn-sm btn-gold" disabled={busy} onClick={() => restoreFrom(f)}>Restore</button>}</td></tr>)}
                {list.exports.map((f: any) => <tr key={f.id}><td className="mono">{f.name}</td><td>{dateTime(f.createdTime)}</td><td className="num">{bytes(Number(f.size ?? 0))}</td><td><a href={f.webViewLink} target="_blank" rel="noopener noreferrer">Open</a></td></tr>)}
              </tbody>
            </table></div>
          )}
        </div>
      ) : (
        <div className="stack">
          <div>Keep a copy of every backup in your own Google Drive (Gmail account), so the data survives even if this computer is lost or damaged.</div>
          {!onServer && <div className="alert amber">Connect Google Drive from the office computer itself (open the ERP there at http://localhost:{location.port || "4000"}).</div>}
          {can("backup.restore") ? (
            <>
              {!s.configured || setup ? (
                <div className="card" style={{ background: "#f7f9fc" }}>
                  <h3>One-time setup (about 5 minutes)</h3>
                  <ol className="small" style={{ paddingLeft: 18, lineHeight: 1.6 }}>
                    <li>Open <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer">console.cloud.google.com</a> with your Gmail account and create a project “GRL ERP”.</li>
                    <li><b>APIs &amp; Services → Library</b> → enable <b>Google Drive API</b>.</li>
                    <li><b>OAuth consent screen</b> → External → app name “GRL ERP”, your email → add scope <span className="mono">…/auth/drive.file</span> → then click <b>PUBLISH APP</b> (otherwise Google disconnects it every 7 days).</li>
                    <li><b>Credentials → Create credentials → OAuth client ID</b> → type <b>Web application</b> → Authorised redirect URI: <span className="mono">{s.redirectUri}</span></li>
                    <li>Copy the Client ID and Client secret here:</li>
                  </ol>
                  <div className="form-grid">
                    <Field label="Client ID"><input value={client.clientId} onChange={(e) => setClient({ ...client, clientId: e.target.value })} placeholder="….apps.googleusercontent.com" /></Field>
                    <Field label="Client secret"><input type="password" value={client.clientSecret} onChange={(e) => setClient({ ...client, clientSecret: e.target.value })} /></Field>
                  </div>
                  <div style={{ marginTop: 10 }}><button className="btn-primary" disabled={busy || !client.clientId || !client.clientSecret} onClick={() => run(() => api.post("/gdrive/client", client), "Saved").then((r) => { if (r) { setSetup(false); st.reload(); } })}>Save</button></div>
                  <p className="muted small">The ERP asks only for permission to its own files (drive.file): it cannot see your other Drive files or your e-mail. The secret and the sign-in token are stored encrypted on this computer.</p>
                </div>
              ) : (
                <div className="row">
                  <button className="btn-primary btn-lg" disabled={busy} onClick={connect}>Connect Google Drive</button>
                  <button className="btn-sm" onClick={() => setSetup(true)}>Change Client ID</button>
                </div>
              )}
            </>
          ) : <div className="muted">Ask an administrator to connect Google Drive.</div>}
        </div>
      )}
    </div>
  );
}
