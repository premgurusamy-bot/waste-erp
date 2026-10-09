import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { displayDate, money, todayIst } from "../format";
import { daysBetween, expiryLevel } from "../../shared/calc";
import { Badge, Field, Loading, MasterSelect, PageHead, Pager, clearOptionCache, useAction, useLoad } from "../components/ui";
import { DocList, DocUpload } from "../components/Docs";

type F = { key: string; label: string; type?: "text" | "number" | "date" | "select" | "textarea" | "master"; options?: string[]; master?: string; required?: boolean };
type Def = { title: string; single: string; fields: F[]; columns: { key: string; label: string; render?: (r: any) => React.ReactNode }[] };

const exp = (d: string | null) => {
  if (!d) return "—";
  const lvl = expiryLevel(daysBetween(todayIst(), d));
  return <>{displayDate(d)} {lvl && <Badge s={lvl} />}</>;
};

export const MASTERS: Record<string, Def> = {
  customers: {
    title: "Customers", single: "Customer",
    fields: [
      { key: "name", label: "Customer name", required: true }, { key: "company", label: "Company" }, { key: "gstin", label: "GSTIN" }, { key: "pan", label: "PAN" },
      { key: "contactPerson", label: "Contact person" }, { key: "mobile", label: "Mobile" }, { key: "email", label: "Email" }, { key: "address", label: "Address", type: "textarea" },
      { key: "city", label: "City" }, { key: "state", label: "State" }, { key: "paymentTerms", label: "Payment terms" }, { key: "creditDays", label: "Credit days", type: "number" },
      { key: "openingBalance", label: "Opening balance (₹, receivable)", type: "number" }, { key: "status", label: "Status", type: "select", options: ["ACTIVE", "INACTIVE"] }, { key: "notes", label: "Notes", type: "textarea" },
    ],
    columns: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "mobile", label: "Mobile" }, { key: "city", label: "City" }, { key: "gstin", label: "GSTIN" }, { key: "creditDays", label: "Credit days" }],
  },
  transporters: {
    title: "Transporters", single: "Transporter",
    fields: [
      { key: "name", label: "Transporter name", required: true }, { key: "contactPerson", label: "Contact person" }, { key: "mobile", label: "Mobile" }, { key: "gstin", label: "GSTIN" },
      { key: "pan", label: "PAN" }, { key: "address", label: "Address", type: "textarea" }, { key: "city", label: "City" }, { key: "bankName", label: "Bank name" }, { key: "bankAccount", label: "Account number" },
      { key: "bankIfsc", label: "IFSC" }, { key: "bankBranch", label: "Branch" }, { key: "upiId", label: "UPI ID" }, { key: "paymentTerms", label: "Payment terms" },
      { key: "openingBalance", label: "Opening balance (₹, payable)", type: "number" }, { key: "status", label: "Status", type: "select", options: ["ACTIVE", "INACTIVE"] }, { key: "notes", label: "Notes", type: "textarea" },
    ],
    columns: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "mobile", label: "Mobile" }, { key: "city", label: "City" }, { key: "bankName", label: "Bank" }],
  },
  vehicles: {
    title: "Vehicles", single: "Vehicle",
    fields: [
      { key: "vehicleNumber", label: "Vehicle number", required: true }, { key: "vehicleType", label: "Vehicle type" }, { key: "capacityTons", label: "Capacity (tons)", type: "number" },
      { key: "ownerName", label: "Owner" }, { key: "ownership", label: "Ownership", type: "select", options: ["MARKET", "OWN", "ATTACHED"] }, { key: "transporterId", label: "Transporter", type: "master", master: "transporters" },
      { key: "rcExpiry", label: "RC expiry", type: "date" }, { key: "insuranceExpiry", label: "Insurance expiry", type: "date" }, { key: "fcExpiry", label: "FC expiry", type: "date" },
      { key: "permitExpiry", label: "Permit expiry", type: "date" }, { key: "pollutionExpiry", label: "Pollution expiry", type: "date" }, { key: "roadTaxExpiry", label: "Road tax expiry", type: "date" },
      { key: "status", label: "Status", type: "select", options: ["ACTIVE", "INACTIVE"] }, { key: "notes", label: "Notes", type: "textarea" },
    ],
    columns: [
      { key: "vehicleNumber", label: "Vehicle" }, { key: "vehicleType", label: "Type" }, { key: "transporter", label: "Transporter", render: (r) => r.transporter?.name },
      { key: "insuranceExpiry", label: "Insurance", render: (r) => exp(r.insuranceExpiry) }, { key: "fcExpiry", label: "FC", render: (r) => exp(r.fcExpiry) }, { key: "permitExpiry", label: "Permit", render: (r) => exp(r.permitExpiry) },
    ],
  },
  drivers: {
    title: "Drivers", single: "Driver",
    fields: [
      { key: "name", label: "Driver name", required: true }, { key: "mobile", label: "Mobile" }, { key: "licenseNumber", label: "License number" }, { key: "licenseExpiry", label: "License expiry", type: "date" },
      { key: "address", label: "Address", type: "textarea" }, { key: "rate", label: "Rate (₹)", type: "number" }, { key: "rateType", label: "Rate type", type: "select", options: ["PER_TRIP", "PER_DAY", "PER_MONTH"] },
      { key: "transporterId", label: "Transporter", type: "master", master: "transporters" }, { key: "status", label: "Status", type: "select", options: ["ACTIVE", "INACTIVE"] }, { key: "notes", label: "Notes", type: "textarea" },
    ],
    columns: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "mobile", label: "Mobile" }, { key: "licenseNumber", label: "License" }, { key: "licenseExpiry", label: "License expiry", render: (r) => exp(r.licenseExpiry) }],
  },
  loadingPoints: {
    title: "Loading Points", single: "Loading point",
    fields: [{ key: "name", label: "Name", required: true }, { key: "address", label: "Address", type: "textarea" }, { key: "city", label: "City" }, { key: "state", label: "State" }, { key: "pincode", label: "Pincode" }, { key: "contactPerson", label: "Contact person" }, { key: "mobile", label: "Mobile" }, { key: "status", label: "Status", type: "select", options: ["ACTIVE", "INACTIVE"] }],
    columns: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "city", label: "City" }, { key: "state", label: "State" }],
  },
  deliveryPoints: {
    title: "Delivery Points", single: "Delivery point",
    fields: [{ key: "name", label: "Name", required: true }, { key: "address", label: "Address", type: "textarea" }, { key: "city", label: "City" }, { key: "state", label: "State" }, { key: "pincode", label: "Pincode" }, { key: "contactPerson", label: "Contact person" }, { key: "mobile", label: "Mobile" }, { key: "status", label: "Status", type: "select", options: ["ACTIVE", "INACTIVE"] }],
    columns: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "city", label: "City" }, { key: "state", label: "State" }],
  },
  freightRates: {
    title: "Freight Rates", single: "Freight rate",
    fields: [
      { key: "customerId", label: "Customer (blank = all)", type: "master", master: "customers" }, { key: "loadingPointId", label: "Loading point", type: "master", master: "loadingPoints" },
      { key: "deliveryPointId", label: "Delivery point", type: "master", master: "deliveryPoints" }, { key: "vehicleType", label: "Vehicle type (blank = any)" },
      { key: "rateType", label: "Rate type", type: "select", options: ["PER_TRIP", "PER_TON", "PER_KM"] }, { key: "customerRate", label: "Customer rate (₹)", type: "number" },
      { key: "transporterRate", label: "Transporter rate (₹)", type: "number" }, { key: "effectiveFrom", label: "Effective from", type: "date" }, { key: "effectiveTo", label: "Effective to", type: "date" },
      { key: "status", label: "Status", type: "select", options: ["ACTIVE", "INACTIVE"] }, { key: "notes", label: "Notes", type: "textarea" },
    ],
    columns: [
      { key: "code", label: "Code" }, { key: "customer", label: "Customer", render: (r) => r.customer?.name ?? "All" }, { key: "route", label: "Route", render: (r) => `${r.loadingPoint?.name ?? "Any"} → ${r.deliveryPoint?.name ?? "Any"}` },
      { key: "rateType", label: "Type" }, { key: "customerRate", label: "Customer", render: (r) => money(r.customerRate) }, { key: "transporterRate", label: "Transporter", render: (r) => money(r.transporterRate) },
    ],
  },
};

export function MasterListPage() {
  const { kind = "customers" } = useParams();
  const def = MASTERS[kind];
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const q = Object.fromEntries(sp.entries());
  const { data, error } = useLoad(() => api.get(`/masters/${kind}`, { ...q, pageSize: 25 }), [kind, sp.toString()]);
  if (!def) return <div className="alert red">Unknown page</div>;
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); n.delete("page"); setSp(n); };
  return (
    <>
      <PageHead title={def.title}>
        {kind === "customers" || kind === "transporters" || kind === "vehicles" || kind === "drivers" ? (
          <>
            <Link className="btn hide-mobile" to="/masters/loadingPoints">Loading points</Link>
            <Link className="btn hide-mobile" to="/masters/deliveryPoints">Delivery points</Link>
            <Link className="btn hide-mobile" to="/masters/freightRates">Freight rates</Link>
          </>
        ) : null}
        {can("masters.edit") && <Link className="btn btn-primary" to={`/masters/${kind}/new`}>+ New {def.single}</Link>}
      </PageHead>
      <div className="filters">
        <input placeholder="Search…" defaultValue={q.q ?? ""} onKeyDown={(e) => e.key === "Enter" && set("q", (e.target as HTMLInputElement).value)} style={{ minWidth: 240 }} />
        <select value={q.status ?? ""} onChange={(e) => set("status", e.target.value)} aria-label="Status"><option value="">All</option><option>ACTIVE</option><option>INACTIVE</option></select>
      </div>
      {!data ? <Loading error={error} /> : (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr>{def.columns.map((c) => <th key={c.key}>{c.label}</th>)}<th>Status</th></tr></thead>
              <tbody>
                {data.rows.length === 0 && <tr><td colSpan={9} className="empty">Nothing yet</td></tr>}
                {data.rows.map((r: any) => (
                  <tr key={r.id}>
                    {def.columns.map((c, i) => <td key={c.key}>{i <= 1 ? <Link to={`/masters/${kind}/${r.id}`}>{c.render ? c.render(r) : r[c.key]}</Link> : c.render ? c.render(r) : r[c.key]}</td>)}
                    <td><Badge s={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => set("page", String(p))} />
        </>
      )}
    </>
  );
}

export function MasterFormPage() {
  const { kind = "customers", id } = useParams();
  const def = MASTERS[kind];
  const nav = useNavigate();
  const [f, setF] = useState<any>(id ? null : { status: "ACTIVE" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  useEffect(() => { if (id) api.get(`/masters/${kind}/${id}`).then(setF); }, [kind, id]);
  if (!def) return null;
  if (!f) return <Loading />;
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    try {
      const r = await (id ? api.put(`/masters/${kind}/${id}`, f) : api.post(`/masters/${kind}`, f));
      clearOptionCache();
      nav(`/masters/${kind}/${r.id}`);
    } catch (err: any) {
      setErrors(err.details?.fields ?? {});
      await run(() => Promise.reject(err));
    }
  };
  return (
    <form onSubmit={save}>
      <PageHead title={id ? `Edit ${def.single} ${f.code ?? ""}` : `New ${def.single}`}>
        <button type="button" onClick={() => nav(-1)}>Cancel</button>
        <button className="btn-primary" disabled={busy}>Save</button>
      </PageHead>
      <div className="card">
        <div className="form-grid">
          {def.fields.map((fl) => (
            <Field key={fl.key} label={`${fl.label}${fl.required ? " *" : ""}`} error={errors[fl.key]} wide={fl.type === "textarea"}>
              {fl.type === "select" ? <select value={f[fl.key] ?? fl.options![0]} onChange={(e) => set(fl.key, e.target.value)}>{fl.options!.map((o) => <option key={o}>{o}</option>)}</select>
                : fl.type === "master" ? <MasterSelect kind={fl.master!} value={f[fl.key]} onChange={(v) => set(fl.key, v)} placeholder="— none —" />
                : fl.type === "textarea" ? <textarea value={f[fl.key] ?? ""} onChange={(e) => set(fl.key, e.target.value)} />
                : <input type={fl.type ?? "text"} step={fl.type === "number" ? "any" : undefined} value={f[fl.key] ?? ""} required={fl.required} onChange={(e) => set(fl.key, e.target.value)} />}
            </Field>
          ))}
        </div>
      </div>
    </form>
  );
}

export function MasterDetailPage() {
  const { kind = "customers", id } = useParams();
  const def = MASTERS[kind];
  const { can } = useAuth();
  const { data: r, error } = useLoad(() => api.get(`/masters/${kind}/${id}`), [kind, id]);
  const docs = useLoad(() => (["vehicles", "drivers", "customers", "transporters"].includes(kind) ? api.get("/documents", { entityType: kind.slice(0, -1).toUpperCase(), entityId: id }) : Promise.resolve({ rows: [] })), [kind, id]);
  const tripFilter = { customers: "customerId", transporters: "transporterId", vehicles: "vehicleId", drivers: "driverId", loadingPoints: "loadingPointId", deliveryPoints: "deliveryPointId" }[kind];
  const trips = useLoad(() => (tripFilter && can("trips.view") ? api.get("/trips", { [tripFilter]: id, pageSize: 10 }) : Promise.resolve(null)), [kind, id]);
  if (!def) return null;
  if (!r) return <Loading error={error} />;
  return (
    <>
      <PageHead title={r.name ?? r.vehicleNumber ?? r.code} sub={<>{r.code} · <Badge s={r.status} /></>}>
        {can("masters.edit") && <Link className="btn" to={`/masters/${kind}/${id}/edit`}>Edit</Link>}
        {tripFilter && can("trips.edit") && kind !== "loadingPoints" && kind !== "deliveryPoints" && <Link className="btn btn-primary" to={`/trips/new`}>+ New trip</Link>}
      </PageHead>
      <div className="grid g2">
        <div className="card">
          <dl className="kv">
            {def.fields.map((f) => {
              let v = r[f.key];
              if (f.type === "master") v = r[f.key.replace(/Id$/, "")]?.name;
              if (f.type === "date") v = v ? exp(v) : "—";
              if (f.key.toLowerCase().includes("balance") || f.key.endsWith("Rate") || f.key === "rate") v = money(v);
              return [<dt key={f.key + "t"}>{f.label}</dt>, <dd key={f.key + "d"}>{v ?? "—"}</dd>];
            })}
            <dt>Record ID</dt><dd className="mono">{r.id}</dd>
          </dl>
        </div>
        <div>
          {["vehicles", "drivers", "customers", "transporters"].includes(kind) && (
            <div className="card">
              <h2>Documents</h2>
              <DocUpload entityType={kind.slice(0, -1).toUpperCase()} entityId={id} defaultType={kind === "vehicles" ? "VEHICLE_DOC" : kind === "drivers" ? "DRIVER_DOC" : "OTHER"} onDone={docs.reload} />
              <div style={{ marginTop: 10 }}><DocList docs={docs.data?.rows ?? []} /></div>
            </div>
          )}
          {trips.data && (
            <div className="card">
              <div className="spread"><h2>Recent trips</h2><Link to={`/trips?${tripFilter}=${id}`}>All {trips.data.total}</Link></div>
              <div className="table-wrap"><table><tbody>
                {trips.data.rows.map((t: any) => <tr key={t.id}><td><Link to={`/trips/${t.id}`}>{t.tripNumber}</Link></td><td>{displayDate(t.tripDate)}</td><td className="num">{money(t.customerFreight)}</td><td><Badge s={t.status} /></td></tr>)}
              </tbody></table></div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
