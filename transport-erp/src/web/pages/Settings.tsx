import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { dateTime, displayDate } from "../format";
import { Badge, Field, Loading, Modal, PageHead, Pager, Tabs, useAction, useLoad } from "../components/ui";

type Tab = "company" | "app" | "users" | "roles" | "license" | "mobile" | "audit" | "password";
const ROLES = ["SUPER_ADMIN", "ADMIN", "TRANSPORT_MANAGER", "OPERATIONS", "ACCOUNTS", "VIEWER"];

export function SettingsPage() {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tabs: { key: Tab; label: string }[] = [
    ...(can("settings.edit") ? [{ key: "company" as Tab, label: "Company" }, { key: "app" as Tab, label: "Application" }] : []),
    ...(can("users.manage") ? [{ key: "users" as Tab, label: "Users" }, { key: "roles" as Tab, label: "Role permissions" }] : []),
    { key: "license", label: "Licence" },
    { key: "mobile", label: "Mobile app" },
    ...(can("audit.view") ? [{ key: "audit" as Tab, label: "Audit log" }] : []),
    { key: "password", label: "My password" },
  ];
  const tab = (sp.get("tab") as Tab) ?? tabs[0].key;
  return (
    <>
      <PageHead title="Settings" />
      <Tabs tabs={tabs} value={tab} onChange={(t) => setSp({ tab: t })} />
      {tab === "company" && <Company />}
      {tab === "app" && <AppSettings />}
      {tab === "users" && <Users />}
      {tab === "roles" && <Roles />}
      {tab === "license" && <License />}
      {tab === "mobile" && <MobileInfo />}
      {tab === "audit" && <Audit />}
      {tab === "password" && <Password />}
    </>
  );
}

function Company() {
  const { reload } = useAuth();
  const [f, setF] = useState<any>(null);
  const { busy, run } = useAction();
  useEffect(() => { api.get("/company").then((c) => setF(c ?? { name: "", invoicePrefix: "GRL" })); }, []);
  if (!f) return <Loading />;
  const fields: [string, string][] = [["name", "Company name *"], ["legalName", "Legal name"], ["gstin", "GSTIN"], ["pan", "PAN"], ["address", "Address"], ["city", "City"], ["state", "State"], ["stateCode", "State code (e.g. 33)"], ["pincode", "Pincode"], ["phone", "Phone"], ["email", "Email"], ["bankName", "Bank name"], ["bankAccount", "Bank account"], ["bankIfsc", "IFSC"], ["invoicePrefix", "Invoice number prefix"]];
  return (
    <div className="card">
      <div className="form-grid">{fields.map(([k, l]) => <Field key={k} label={l}><input value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}</div>
      <p className="muted small">Invoice numbers look like {f.invoicePrefix || "GRL"}/2026-27/0001 and restart each financial year (1 April).</p>
      <button className="btn-primary" disabled={busy} onClick={() => run(() => api.put("/company", f), "Company saved").then(reload)}>Save</button>
    </div>
  );
}

function AppSettings() {
  const { data, error, setData } = useLoad(() => api.get("/settings"), []);
  const { busy, run } = useAction();
  if (!data) return <Loading error={error} />;
  const set = (k: string, v: string) => setData({ ...data, [k]: v });
  return (
    <div className="card">
      <div className="form-section" style={{ marginTop: 0 }}><h3>Backup</h3>
        <div className="form-grid">
          <Field label="Automatic Excel backup (daily, when the ERP is opened)"><select value={data["backup.auto"]} onChange={(e) => set("backup.auto", e.target.value)}><option value="true">ON</option><option value="false">OFF (not recommended)</option></select></Field>
          <Field label="Include database backup with the automatic backup"><select value={data["backup.autoDatabase"]} onChange={(e) => set("backup.autoDatabase", e.target.value)}><option value="true">YES</option><option value="false">NO</option></select></Field>
          <Field label="Keep last N daily backups"><input type="number" min="1" value={data["backup.keepDaily"]} onChange={(e) => set("backup.keepDaily", e.target.value)} /></Field>
          <Field label="Keep last N monthly backups"><input type="number" min="1" value={data["backup.keepMonthly"]} onChange={(e) => set("backup.keepMonthly", e.target.value)} /></Field>
        </div>
      </div>
      <div className="form-section"><h3>GST defaults for new invoices (never applied automatically: you can change them on each invoice)</h3>
        <div className="form-grid">
          <Field label="Default GST treatment"><select value={data["gst.defaultType"]} onChange={(e) => set("gst.defaultType", e.target.value)}><option value="NONE">No GST</option><option value="CGST_SGST">CGST + SGST</option><option value="IGST">IGST</option><option value="RCM">Reverse charge</option></select></Field>
          <Field label="Default GST rate %"><select value={data["gst.defaultRate"]} onChange={(e) => set("gst.defaultRate", e.target.value)}>{["0", "5", "12", "18"].map((r) => <option key={r}>{r}</option>)}</select></Field>
          <Field label="SAC code"><input value={data["gst.sacCode"]} onChange={(e) => set("gst.sacCode", e.target.value)} /></Field>
          <Field label="Invoice terms" wide><textarea value={data["invoice.terms"]} onChange={(e) => set("invoice.terms", e.target.value)} /></Field>
        </div>
      </div>
      <div className="form-section"><h3>Alerts</h3>
        <div className="form-grid"><Field label="Show expiry alerts this many days ahead"><input type="number" min="1" value={data["alerts.expiryDays"]} onChange={(e) => set("alerts.expiryDays", e.target.value)} /></Field></div>
      </div>
      <button className="btn-primary" disabled={busy} onClick={() => run(() => api.put("/settings", Object.fromEntries(Object.entries(data).filter(([k]) => !k.startsWith("license.")))), "Settings saved")}>Save settings</button>
    </div>
  );
}

function Users() {
  const { data, error, reload } = useLoad(() => api.get("/users"), []);
  const [edit, setEdit] = useState<any>(null);
  const { busy, run } = useAction();
  if (!data) return <Loading error={error} />;
  const save = async () => { const r = await run(() => (edit.id ? api.put(`/users/${edit.id}`, edit) : api.post("/users", edit)), "User saved"); if (r) { setEdit(null); reload(); } };
  return (
    <>
      <div className="spread" style={{ marginBottom: 10 }}><span className="muted">Passwords are stored as bcrypt hashes. Disabled users cannot sign in.</span><button className="btn-primary" onClick={() => setEdit({ role: "OPERATIONS", active: true })}>+ New user</button></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Username</th><th>Name</th><th>Role</th><th className="hide-mobile">Mobile</th><th className="hide-mobile">Last login</th><th>Status</th><th></th></tr></thead>
        <tbody>{data.map((u: any) => <tr key={u.id}><td>{u.username}</td><td>{u.name}</td><td>{u.role.replace(/_/g, " ")}</td><td className="hide-mobile">{u.mobile}</td><td className="hide-mobile">{dateTime(u.lastLoginAt)}</td><td><Badge s={u.active ? "ACTIVE" : "INACTIVE"} /></td><td><button className="btn-sm" onClick={() => setEdit({ ...u, password: "" })}>Edit</button></td></tr>)}</tbody>
      </table></div>
      {edit && (
        <Modal title={edit.id ? `Edit ${edit.username}` : "New user"} onClose={() => setEdit(null)} footer={<><button onClick={() => setEdit(null)}>Cancel</button><button className="btn-primary" disabled={busy} onClick={save}>Save</button></>}>
          <div className="form-grid">
            <Field label="Username"><input value={edit.username ?? ""} onChange={(e) => setEdit({ ...edit, username: e.target.value })} /></Field>
            <Field label="Full name"><input value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Role"><select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}</select></Field>
            <Field label="Mobile"><input value={edit.mobile ?? ""} onChange={(e) => setEdit({ ...edit, mobile: e.target.value })} /></Field>
            <Field label="Email"><input value={edit.email ?? ""} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label={edit.id ? "New password (leave blank to keep)" : "Password"}><input type="password" value={edit.password ?? ""} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field>
            <label className="check"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label>
          </div>
        </Modal>
      )}
    </>
  );
}

function Roles() {
  const { data, error, setData } = useLoad(() => api.get("/roles"), []);
  const labels = useLoad(() => api.get("/auth/me").then((m) => m.permissionLabels), []);
  const { busy, run } = useAction();
  if (!data || !labels.data) return <Loading error={error} />;
  const perms = Object.keys(labels.data);
  const locked = new Set<string>(data.locked.SUPER_ADMIN);
  const toggle = (role: string, p: string) => setData({ ...data, matrix: { ...data.matrix, [role]: { ...data.matrix[role], [p]: !data.matrix[role][p] } } });
  return (
    <div className="card">
      <div className="table-wrap"><table>
        <thead><tr><th>Permission</th>{ROLES.map((r) => <th key={r} className="small">{r.replace(/_/g, " ")}</th>)}</tr></thead>
        <tbody>{perms.map((p) => <tr key={p}><td>{labels.data[p]}<div className="muted small mono">{p}</div></td>{ROLES.map((r) => <td key={r} style={{ textAlign: "center" }}><input type="checkbox" aria-label={`${r} ${p}`} checked={!!data.matrix[r][p]} disabled={r === "SUPER_ADMIN" && locked.has(p)} onChange={() => toggle(r, p)} /></td>)}</tr>)}</tbody>
      </table></div>
      <p className="muted small">SUPER ADMIN always keeps users, backup, restore, settings and licence permissions so nobody can be locked out of the company's data.</p>
      <button className="btn-primary" disabled={busy} onClick={() => run(() => api.put("/roles", { matrix: data.matrix }), "Permissions saved")}>Save permissions</button>
    </div>
  );
}

function License() {
  const { can, reload, me } = useAuth();
  const { data, error, reload: r2 } = useLoad(() => api.get("/license"), []);
  const [key, setKey] = useState("");
  const { busy, run } = useAction();
  if (!data) return <Loading error={error} />;
  const s = data.status;
  return (
    <div className="grid g2">
      <div className="card">
        <h2>GRL ERP · Version {me?.version}</h2>
        <div className={`alert ${s.level === "OK" ? "green" : s.level === "WARNING" ? "amber" : "red"}`}>{s.message}</div>
        <dl className="kv">
          <dt>Licence status</dt><dd><Badge s={s.level} /></dd>
          <dt>Plan</dt><dd>{s.plan}</dd><dt>Licence ID</dt><dd>{s.licenseId ?? "—"}</dd><dt>Company</dt><dd>{s.company ?? "—"}</dd>
          <dt>Start date</dt><dd>{displayDate(s.startDate)}</dd><dt>Expiry date</dt><dd>{s.expiryDate ? displayDate(s.expiryDate) : "Never (perpetual)"}</dd>
          <dt>Days left</dt><dd>{s.daysLeft ?? "—"}</dd><dt>Maximum users</dt><dd>{s.maxUsers ?? "Unlimited"}</dd>
          <dt>This computer's Machine ID</dt><dd className="mono">{data.machineId}</dd>
        </dl>
        <p className="muted small">When a licence expires nothing is deleted: the ERP becomes read-only, and backup, export and licence renewal keep working. Send the Machine ID to your administrator to get a key for this computer.</p>
      </div>
      <div className="card">
        <h2>Install / renew licence key</h2>
        {can("license.manage") ? (
          <>
            <textarea placeholder="Paste the licence key (starts with GRL1.)" value={key} onChange={(e) => setKey(e.target.value)} style={{ minHeight: 120 }} className="mono" />
            <div style={{ marginTop: 10 }}><button className="btn-primary" disabled={busy || !key.trim()} onClick={() => run(() => api.post("/license", { key }), "Licence installed").then((x) => { if (x) { setKey(""); r2(); reload(); } })}>Install licence</button></div>
          </>
        ) : <div className="muted">Ask a SUPER ADMIN to install the licence key.</div>}
        <h3 style={{ marginTop: 16 }}>History</h3>
        <table><tbody>{data.history.map((h: any) => <tr key={h.id}><td>{h.licenseId}</td><td>{h.plan}</td><td>{displayDate(h.expiryDate) || "perpetual"}</td><td><Badge s={h.status} /></td><td className="small">{dateTime(h.installedAt)}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}

function Audit() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState({ action: "", user: "", q: "" });
  const { data, error } = useLoad(() => api.get("/audit", { ...q, page, pageSize: 50 }), [page, q.action, q.user, q.q]);
  const [show, setShow] = useState<any>(null);
  return (
    <>
      <div className="filters">
        <select value={q.action} onChange={(e) => { setQ({ ...q, action: e.target.value }); setPage(1); }} aria-label="Action"><option value="">All actions</option>{["LOGIN", "LOGOUT", "CREATE", "EDIT", "STATUS", "CANCEL", "PAYMENT", "INVOICE", "SETTLEMENT", "BACKUP", "VERIFY BACKUP", "RESTORE", "IMPORT", "EXPORT", "LICENSE CHANGE", "PASSWORD CHANGE"].map((a) => <option key={a}>{a}</option>)}</select>
        <input placeholder="User" onKeyDown={(e) => e.key === "Enter" && setQ({ ...q, user: (e.target as HTMLInputElement).value })} />
        <input placeholder="Record code" onKeyDown={(e) => e.key === "Enter" && setQ({ ...q, q: (e.target as HTMLInputElement).value })} />
      </div>
      {!data ? <Loading error={error} /> : (
        <>
          <div className="table-wrap"><table>
            <thead><tr><th>Date / time</th><th>User</th><th>Action</th><th>Record</th><th className="hide-mobile">IP</th><th></th></tr></thead>
            <tbody>{data.rows.map((a: any) => <tr key={a.id}><td className="nowrap">{dateTime(a.at)}</td><td>{a.userName}</td><td><b>{a.action}</b></td><td>{a.entityType} {a.recordCode}</td><td className="hide-mobile">{a.ip}</td><td>{(a.oldValue || a.newValue) && <button className="btn-sm" onClick={() => setShow(a)}>Changes</button>}</td></tr>)}</tbody>
          </table></div>
          <Pager page={page} pageSize={50} total={data.total} onPage={setPage} />
        </>
      )}
      {show && (
        <Modal wide title={`${show.action} ${show.entityType ?? ""} ${show.recordCode ?? ""}`} onClose={() => setShow(null)}>
          <div className="table-wrap"><table>
            <thead><tr><th>Field</th><th>Old value</th><th>New value</th></tr></thead>
            <tbody>{[...new Set([...Object.keys(show.oldValue ?? {}), ...Object.keys(show.newValue ?? {})])].map((k) => <tr key={k}><td>{k}</td><td className="mono">{JSON.stringify(show.oldValue?.[k] ?? "")}</td><td className="mono">{JSON.stringify(show.newValue?.[k] ?? "")}</td></tr>)}</tbody>
          </table></div>
        </Modal>
      )}
    </>
  );
}

function Password() {
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const { busy, run } = useAction();
  return (
    <div className="card" style={{ maxWidth: 420 }}>
      <div className="stack">
        <Field label="Current password"><input type="password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
        <Field label="New password (8+ characters, letters and numbers)"><input type="password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
        <Field label="Confirm new password"><input type="password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
        <button className="btn-primary" disabled={busy || !f.next || f.next !== f.confirm} onClick={() => run(() => api.post("/auth/password", f), "Password changed").then(() => setF({ current: "", next: "", confirm: "" }))}>Change password</button>
      </div>
    </div>
  );
}

function MobileInfo() {
  const { data, error } = useLoad(() => api.get("/server-info"), []);
  if (!data) return <Loading error={error} />;
  return (
    <div className="card" style={{ maxWidth: 720 }}>
      <h2>Use the ERP on Android phones</h2>
      <ol>
        <li>On this office computer run <b>ALLOW-PHONES.bat</b> once (opens port {data.port} in Windows Firewall).</li>
        <li>Install the <b>GRL ERP</b> Android app (APK) on the phone, or open the address below in Chrome and choose <b>Add to Home screen</b>.</li>
        <li>Connect the phone to the office Wi-Fi, open the app and type this server address:</li>
      </ol>
      {data.addresses.length ? data.addresses.map((a: string) => <div key={a} className="mono" style={{ fontSize: 20, margin: "6px 0" }}>{a}</div>) : <div className="alert amber">No network address found. Connect this computer to the office network.</div>}
      <p className="muted small">Ask your network provider for a fixed IP address for this computer so the address never changes. Phones only show data; everything is stored on this computer and included in its backups.</p>
    </div>
  );
}
