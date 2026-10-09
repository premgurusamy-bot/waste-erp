import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, download } from "../api";
import { useAuth } from "../auth";
import { Badge, Field, Loading, PageHead, Tabs, useAction, useLoad, useToast, clearOptionCache } from "../components/ui";
import { PlanView, ResultView } from "./Backup";

export function ImportExportPage() {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tabs = [...(can("backup.restore") ? [{ key: "import" as const, label: "Import client data" }] : []), { key: "export" as const, label: "Export data" }];
  const tab = (sp.get("tab") as "import" | "export") ?? tabs[0].key;
  return (
    <>
      <PageHead title="Import & Export" sub="Bring in data from any Excel / CSV / JSON file, and export ERP data in the format you need" />
      <Tabs tabs={tabs} value={tab} onChange={(t) => setSp({ tab: t })} />
      {tab === "import" ? <ImportWizard /> : <ExportPanel />}
    </>
  );
}

// ---------------------------------------------------------------- import
function ImportWizard() {
  const targets = useLoad(() => api.get("/data-import/targets"), []);
  const input = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<any>(null);
  const [table, setTable] = useState(0);
  const [target, setTarget] = useState("");
  const [fields, setFields] = useState<any[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [opts, setOpts] = useState({ createMissing: true, existing: "update", tripStatus: "DELIVERED" });
  const [prep, setPrep] = useState<any>(null);
  const [plan, setPlan] = useState<any>(null);
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [result, setResult] = useState<any>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  const reset = (keepFile = false) => { if (!keepFile) setUpload(null); setPrep(null); setPlan(null); setResult(null); setSkipInvalid(false); };

  const choose = async (f?: File) => {
    if (!f) return;
    reset();
    const r = await run(() => api.upload("/data-import/upload", f));
    if (r) { setUpload(r); setTable(0); setTarget(""); setFields([]); setMapping({}); }
    if (input.current) input.current.value = "";
  };
  const pickTarget = async (t: string, tableIdx = table) => {
    setTarget(t); reset(true);
    if (!t) return;
    const r = await run(() => api.post("/data-import/suggest", { token: upload.token, table: tableIdx, target: t }));
    if (r) { setFields(r.fields); setMapping(r.mapping); }
  };
  const check = async (skip = skipInvalid) => {
    const p = await run(() => api.post("/data-import/prepare", { token: upload.token, table, target, mapping, createMissing: opts.createMissing, existing: opts.existing, defaults: target === "trips" ? { status: opts.tripStatus } : undefined }));
    if (!p) return;
    setPrep(p);
    const pv = await run(() => api.post("/restore/preview", { token: p.token, mode: "IMPORT", sheets: p.sheets, skipInvalid: skip }));
    if (pv) setPlan(pv.plan);
  };
  const doImport = async () => {
    if (!window.confirm("A safety backup of the current data is made first. Import now?")) return;
    const r = await run(() => api.post("/restore/run", { token: prep.token, mode: "IMPORT", sheets: prep.sheets, skipInvalid, confirm: true }));
    if (r) { setResult(r); clearOptionCache(); toast(r.ok ? "ok" : "err", r.status); }
  };

  if (!targets.data) return <Loading error={targets.error} />;
  const t = upload?.tables[table];
  const required = fields.filter((f) => f.required);
  const mappedFields = new Set(Object.values(mapping).filter(Boolean));
  const missing = required.filter((f) => !mappedFields.has(f.key));

  if (result) {
    return (
      <div className="card">
        <ResultView r={result} />
        <div style={{ marginTop: 12 }}><button className="btn-primary" onClick={() => { reset(); }}>Import another file</button></div>
      </div>
    );
  }
  return (
    <div className="stack">
      <div className="card">
        <h2>1. Choose the file</h2>
        <p className="muted">Excel (.xlsx), CSV, TSV, TXT or JSON — exported from Tally, Busy, another ERP, a WhatsApp list, or the client's own register. Title rows, Indian amounts like “Rs. 1,25,000/-” and dates like 08-Oct-2026 are understood. For old .xls / .ods files use “Save As .xlsx” first.</p>
        <div className="row">
          <button className="btn-primary" disabled={busy} onClick={() => input.current?.click()}>📂 Choose file</button>
          <input ref={input} type="file" hidden accept={targets.data.extensions.join(",")} onChange={(e) => choose(e.target.files?.[0])} />
          {upload && <span>File: <b className="mono">{upload.fileName}</b> · {upload.tables.length} sheet(s)</span>}
        </div>
      </div>

      {upload && (
        <div className="card">
          <h2>2. What is in it?</h2>
          <div className="form-grid">
            {upload.tables.length > 1 && <Field label="Sheet"><select value={table} onChange={(e) => { const i = Number(e.target.value); setTable(i); if (target) pickTarget(target, i); }}>{upload.tables.map((x: any) => <option key={x.index} value={x.index}>{x.name} ({x.rowCount} rows)</option>)}</select></Field>}
            <Field label="The rows are…"><select value={target} onChange={(e) => pickTarget(e.target.value)}><option value="">— choose —</option>{targets.data.targets.map((x: any) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></Field>
          </div>
          <div className="muted small" style={{ marginTop: 6 }}>Header found on row {t?.headerRow}; {t?.rowCount} data row(s).</div>
        </div>
      )}

      {upload && target && fields.length > 0 && (
        <div className="card">
          <h2>3. Match the columns</h2>
          <p className="muted small">Suggested automatically — check and change where needed. Columns set to “ignore” are not imported. Names (customer, vehicle, driver, places, transporter) are matched to existing records; the record code and ID are created automatically.</p>
          <div className="table-wrap"><table>
            <thead><tr><th>Column in the file</th><th>Example values</th><th>ERP field</th></tr></thead>
            <tbody>{t.headers.map((h: string, i: number) => (
              <tr key={i}>
                <td><b>{h}</b></td>
                <td className="small muted">{t.sample.slice(0, 3).map((r: any[]) => r[i]).filter((v: any) => v !== null && v !== undefined && v !== "").map(String).join(" · ").slice(0, 80)}</td>
                <td><select value={mapping[i] ?? ""} onChange={(e) => { setMapping({ ...mapping, [i]: e.target.value }); reset(true); }} style={{ minWidth: 220 }}>
                  <option value="">— ignore —</option>
                  {fields.map((f) => <option key={f.key} value={f.key} disabled={mappedFields.has(f.key) && mapping[i] !== f.key}>{f.label}{f.required ? " *" : ""}</option>)}
                </select></td>
              </tr>
            ))}</tbody>
          </table></div>
          {missing.length > 0 && <div className="alert amber" style={{ marginTop: 10 }}>Still needed: {missing.map((f) => f.label).join(", ")}</div>}
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label className="check"><input type="checkbox" checked={opts.createMissing} onChange={(e) => { setOpts({ ...opts, createMissing: e.target.checked }); reset(true); }} /> Create customers / vehicles / drivers / places / transporters that are not in the ERP yet</label>
            <Field label="Rows that match an existing record"><select value={opts.existing} onChange={(e) => { setOpts({ ...opts, existing: e.target.value }); reset(true); }}><option value="update">Update it (fields not in the file are kept)</option><option value="skip">Skip it (keep the ERP version)</option></select></Field>
            {target === "trips" && !mappedFields.has("status") && <Field label="Status for these trips"><select value={opts.tripStatus} onChange={(e) => { setOpts({ ...opts, tripStatus: e.target.value }); reset(true); }}>{["BOOKED", "IN TRANSIT", "DELIVERED", "POD RECEIVED", "BILLED", "CLOSED"].map((x) => <option key={x}>{x}</option>)}</select></Field>}
          </div>
          <div style={{ marginTop: 12 }}><button className="btn-primary" disabled={busy || missing.length > 0} onClick={() => check()}>{busy ? "Checking…" : "Check data"}</button></div>
        </div>
      )}

      {prep && plan && (
        <div className="card">
          <h2>4. Check and import</h2>
          <div className="health" style={{ marginBottom: 12 }}>
            <div>Rows in file<b>{prep.summary.rowsInFile}</b></div>
            <div>Rows to import<b>{prep.summary.rowsToImport}</b></div>
            <div>Match existing records<b>{prep.summary.matchedExisting}{prep.summary.skippedExisting ? ` (${prep.summary.skippedExisting} skipped)` : ""}</b></div>
            {Object.entries(prep.summary.newMasters).map(([k, v]: any) => <div key={k}>New {k.toLowerCase()}<b title={v.join(", ")}>{v.length}</b></div>)}
          </div>
          {Object.entries(prep.summary.newMasters).map(([k, v]: any) => <div key={k} className="small muted">New {k.toLowerCase()}: {v.slice(0, 30).join(", ")}{v.length > 30 ? "…" : ""}</div>)}
          {prep.problems.length > 0 && (
            <div className="alert amber" style={{ display: "block", marginTop: 10 }}><b>Please check:</b><ul style={{ margin: "4px 0 0" }}>{prep.problems.slice(0, 50).map((p: any, i: number) => <li key={i}>Row {p.row} · {p.field} “{p.value}”: {p.error}</li>)}</ul></div>
          )}
          <p className="muted small">Row numbers below are the row numbers in your file.</p>
          <PlanView plan={plan} forImport />
          <div className="row" style={{ marginTop: 12 }}>
            {plan.needsSkipInvalidConfirmation && <label className="check"><input type="checkbox" checked={skipInvalid} onChange={(e) => { setSkipInvalid(e.target.checked); check(e.target.checked); }} /> Skip the {plan.errorCount} invalid row(s) and import the rest</label>}
            <button className="btn-primary" disabled={busy || !plan.canProceed} onClick={doImport}>{busy ? "Importing…" : "Import"}</button>
            <span className="muted small">A safety backup is made first; you can roll back from Backup &amp; Restore → Restore history.</span>
          </div>
        </div>
      )}
      {upload && <div><Badge s="INFO" /> <span className="small muted">Nothing is saved until you click Import.</span></div>}
    </div>
  );
}

// ---------------------------------------------------------------- export
const FORMAT_LABEL: Record<string, string> = { xlsx: "Excel", csv: "CSV", tsv: "TSV", json: "JSON", xml: "XML", pdf: "PDF", html: "HTML (print)" };

function ExportPanel() {
  const d = useLoad(() => api.get("/data-export/datasets"), []);
  const drive = useLoad(() => api.get("/gdrive/status").catch(() => null), []);
  const [key, setKey] = useState("trips");
  const [range, setRange] = useState({ from: "", to: "" });
  const [link, setLink] = useState<{ name: string; link: string } | null>(null);
  const { busy, run } = useAction();
  if (!d.data) return <Loading error={d.error} />;
  const ds = d.data.datasets.find((x: any) => x.key === key);
  const q = new URLSearchParams({ ...(range.from && ds?.dateFilter ? { from: range.from } : {}), ...(range.to && ds?.dateFilter ? { to: range.to } : {}) });
  const multiOnly = key === "all";
  const toDrive = async (format: string) => {
    setLink(null);
    const r = await run(() => api.post(`/data-export/${key}/drive`, { format, from: range.from || undefined, to: range.to || undefined }), format === "gsheet" ? "Created in Google Sheets" : "Saved to Google Drive");
    if (r) setLink(r);
  };
  return (
    <div className="card">
      <div className="form-grid">
        <Field label="Data">
          <select value={key} onChange={(e) => { setKey(e.target.value); setLink(null); }}>
            <option value="all">ALL DATA (every table)</option>
            {d.data.datasets.map((x: any) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </Field>
        {ds?.dateFilter && <><Field label="From date"><input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field><Field label="To date"><input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field></>}
      </div>
      <h3 style={{ marginTop: 16 }}>Download</h3>
      <div className="row">
        {d.data.formats.filter((f: string) => !multiOnly || ["xlsx", "json", "xml"].includes(f)).map((f: string) => (
          <button key={f} onClick={() => download(`/data-export/${key}?${new URLSearchParams({ ...Object.fromEntries(q), format: f }).toString()}`)}>{FORMAT_LABEL[f]}</button>
        ))}
      </div>
      <h3 style={{ marginTop: 16 }}>Google</h3>
      {drive.data?.connected ? (
        <div className="row">
          {!multiOnly && <button className="btn-primary" disabled={busy} onClick={() => toDrive("gsheet")}>Open in Google Sheets</button>}
          {!multiOnly && <button disabled={busy} onClick={() => toDrive("xlsx")}>Save Excel to Google Drive</button>}
          {multiOnly && <button className="btn-primary" disabled={busy} onClick={() => toDrive("xlsx")}>Save all data (Excel) to Google Drive</button>}
          <button disabled={busy} onClick={() => toDrive(multiOnly ? "json" : "csv")}>Save {multiOnly ? "JSON" : "CSV"} to Google Drive</button>
        </div>
      ) : <div className="muted small">Connect Google Drive on the Backup &amp; Restore page to send exports straight to Google Sheets / Drive.</div>}
      {link && <div className="alert green" style={{ marginTop: 12 }}>✔ {link.name} — <a href={link.link} target="_blank" rel="noopener noreferrer">open</a></div>}
      <p className="muted small" style={{ marginTop: 14 }}>Excel, CSV, TSV, JSON and XML contain every field (with names next to IDs) and can be imported back. PDF and HTML are for reading and printing. For a complete backup that can be restored, use Backup &amp; Restore.</p>
    </div>
  );
}
