import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { displayDate, money, todayIst } from "../format";
import { tripProfit, TRIP_STATUSES } from "../../shared/calc";
import { Badge, Field, Loading, MasterSelect, Modal, Money, PageHead, Pager, useAction, useLoad } from "../components/ui";
import { DocList, DocUpload } from "../components/Docs";

export function TripsPage() {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const q = Object.fromEntries(sp.entries());
  const page = Number(q.page ?? 1);
  const { data, error } = useLoad(() => api.get("/trips", { ...q, pageSize: 25 }), [sp.toString()]);
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); n.delete("page"); setSp(n); };
  return (
    <>
      <PageHead title="Trips" sub="Booking → allocation → loading → transit → delivery → POD → billing → settlement">
        {can("trips.edit") && <Link className="btn btn-primary" to="/trips/new">+ New Trip</Link>}
      </PageHead>
      <div className="filters">
        <input placeholder="Trip no, LR, e-way bill, vehicle, customer…" defaultValue={q.q ?? ""} onKeyDown={(e) => e.key === "Enter" && set("q", (e.target as HTMLInputElement).value)} style={{ minWidth: 260 }} />
        <select value={q.status ?? ""} onChange={(e) => set("status", e.target.value)} aria-label="Status"><option value="">All statuses</option>{TRIP_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        <input type="date" value={q.from ?? ""} onChange={(e) => set("from", e.target.value)} aria-label="From" />
        <input type="date" value={q.to ?? ""} onChange={(e) => set("to", e.target.value)} aria-label="To" />
        <div style={{ minWidth: 180 }}><MasterSelect kind="customers" value={q.customerId} onChange={(v) => set("customerId", v)} placeholder="All customers" /></div>
        <div style={{ minWidth: 160 }} className="hide-mobile"><MasterSelect kind="vehicles" value={q.vehicleId} onChange={(v) => set("vehicleId", v)} placeholder="All vehicles" /></div>
      </div>
      {!data ? <Loading error={error} /> : (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Trip</th><th>Date</th><th>Customer</th><th className="hide-mobile">Vehicle / Driver</th><th className="hide-mobile">Route</th><th className="hide-mobile">LR</th><th className="num">Freight</th><th className="num hide-mobile">Hire</th>{can("profit.view") && <th className="num">Profit</th>}<th>Status</th></tr></thead>
              <tbody>
                {data.rows.length === 0 && <tr><td colSpan={10} className="empty">No trips found</td></tr>}
                {data.rows.map((t: any) => (
                  <tr key={t.id}>
                    <td><Link to={`/trips/${t.id}`}><b>{t.tripNumber}</b></Link></td>
                    <td className="nowrap">{displayDate(t.tripDate)}</td>
                    <td>{t.customer?.name}<div className="muted small">{t.transporter?.name}</div></td>
                    <td className="hide-mobile">{t.vehicle?.vehicleNumber}<div className="muted small">{t.driver?.name}</div></td>
                    <td className="hide-mobile">{t.loadingPoint?.name} → {t.deliveryPoint?.name}</td>
                    <td className="hide-mobile">{t.lrNumber}</td>
                    <td className="num">{money(t.customerFreight)}</td>
                    <td className="num hide-mobile">{money(t.transporterHire)}</td>
                    {can("profit.view") && <td className="num"><Money v={t.profit} color /></td>}
                    <td><Badge s={t.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={(p) => { const n = new URLSearchParams(sp); n.set("page", String(p)); setSp(n); }} />
        </>
      )}
    </>
  );
}

const MONEY_FIELDS: [string, string][] = [
  ["customerFreight", "Customer Freight (Revenue)"], ["transporterHire", "Transporter Hire"], ["loadingCharges", "Loading"], ["unloadingCharges", "Unloading"],
  ["diesel", "Diesel"], ["toll", "Toll"], ["rto", "RTO"], ["driverBata", "Driver Bata"], ["otherExpense", "Other Expense"], ["advance", "Advance to Transporter"],
];

const EMPTY = { tripDate: todayIst(), status: "BOOKED", unit: "TONS", items: [] as any[] };

export function TripFormPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const [f, setF] = useState<any>(id ? null : { ...EMPTY });
  const [rateNote, setRateNote] = useState("");
  const { busy, run } = useAction();
  useEffect(() => { if (id) api.get(`/trips/${id}`).then((t) => setF({ ...t, items: t.items ?? [] })); }, [id]);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  // freight rate card
  useEffect(() => {
    if (!f || id || !f.customerId || !f.loadingPointId || !f.deliveryPointId) return;
    api.get("/freight-rate/find", { customerId: f.customerId, loadingPointId: f.loadingPointId, deliveryPointId: f.deliveryPointId, date: f.tripDate }).then((r) => {
      if (!r) { setRateNote(""); return; }
      const mult = r.rateType === "PER_TON" ? Number(f.weightTons || 0) : r.rateType === "PER_KM" ? Number(f.distanceKm || 0) : 1;
      setRateNote(`Rate card ${r.code}: customer ${money(r.customerRate)} / transporter ${money(r.transporterRate)} ${r.rateType.replace("_", " ").toLowerCase()}`);
      setF((x: any) => ({ ...x, customerFreight: x.customerFreight || Math.round(r.customerRate * (mult || 1)), transporterHire: x.transporterHire || Math.round(r.transporterRate * (mult || 1)) }));
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f?.customerId, f?.loadingPointId, f?.deliveryPointId]);
  const p = useMemo(() => (f ? tripProfit(f) : null), [f]);
  if (!f) return <Loading />;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await run(() => (id ? api.put(`/trips/${id}`, f) : api.post("/trips", f)), id ? "Trip saved" : "Trip created");
    if (r) nav(`/trips/${r.id}`);
  };
  return (
    <form onSubmit={save}>
      <PageHead title={id ? `Edit ${f.tripNumber}` : "New Trip"}>
        <button type="button" onClick={() => nav(-1)}>Cancel</button>
        <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save Trip"}</button>
      </PageHead>
      <div className="grid g3">
        <div className="card" style={{ gridColumn: "span 2" }}>
          <div className="form-grid">
            <Field label="Trip date *"><input type="date" value={f.tripDate ?? ""} onChange={(e) => set("tripDate", e.target.value)} required /></Field>
            <Field label="Customer *"><MasterSelect kind="customers" value={f.customerId} onChange={(v) => set("customerId", v)} required /></Field>
            <Field label="Status"><select value={f.status} onChange={(e) => set("status", e.target.value)}>{TRIP_STATUSES.filter((s) => s !== "CANCELLED").map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="Loading point"><MasterSelect kind="loadingPoints" value={f.loadingPointId} onChange={(v) => set("loadingPointId", v)} /></Field>
            <Field label="Delivery point"><MasterSelect kind="deliveryPoints" value={f.deliveryPointId} onChange={(v) => set("deliveryPointId", v)} /></Field>
            <Field label="Distance KM"><input type="number" step="0.1" min="0" value={f.distanceKm ?? ""} onChange={(e) => set("distanceKm", e.target.value)} /></Field>
            <Field label="Transporter"><MasterSelect kind="transporters" value={f.transporterId} onChange={(v) => set("transporterId", v)} /></Field>
            <Field label="Vehicle"><MasterSelect kind="vehicles" value={f.vehicleId} onChange={(v, o) => { set("vehicleId", v); if (o?.extra?.transporterId && !f.transporterId) set("transporterId", o.extra.transporterId); }} /></Field>
            <Field label="Driver"><MasterSelect kind="drivers" value={f.driverId} onChange={(v) => set("driverId", v)} /></Field>
          </div>
          <div className="form-section"><h3>Load</h3>
            <div className="form-grid">
              <Field label="Material"><input value={f.material ?? ""} onChange={(e) => set("material", e.target.value)} /></Field>
              <Field label="Quantity"><input type="number" step="0.001" min="0" value={f.quantity ?? ""} onChange={(e) => set("quantity", e.target.value)} /></Field>
              <Field label="Unit"><input value={f.unit ?? ""} onChange={(e) => set("unit", e.target.value)} placeholder="TONS / BAGS / BOXES" /></Field>
              <Field label="Weight (tons)"><input type="number" step="0.001" min="0" value={f.weightTons ?? ""} onChange={(e) => set("weightTons", e.target.value)} /></Field>
              <Field label="LR number"><input value={f.lrNumber ?? ""} onChange={(e) => set("lrNumber", e.target.value)} /></Field>
              <Field label="LR date"><input type="date" value={f.lrDate ?? ""} onChange={(e) => set("lrDate", e.target.value)} /></Field>
              <Field label="E-Way Bill number"><input value={f.ewayBillNumber ?? ""} onChange={(e) => set("ewayBillNumber", e.target.value)} /></Field>
              <Field label="E-Way Bill valid till"><input type="date" value={f.ewayBillExpiry ?? ""} onChange={(e) => set("ewayBillExpiry", e.target.value)} /></Field>
            </div>
          </div>
          <div className="form-section"><h3>Freight, hire and trip expenses</h3>
            {rateNote && <div className="alert blue small">{rateNote}</div>}
            <div className="form-grid">
              {MONEY_FIELDS.map(([k, l]) => <Field key={k} label={l}><input type="number" step="0.01" min="0" value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} /></Field>)}
            </div>
          </div>
          <div className="form-section"><h3>Consignment items (optional)</h3>
            {(f.items ?? []).map((it: any, i: number) => (
              <div className="form-grid" key={i} style={{ marginBottom: 8 }}>
                <Field label="Description"><input value={it.description ?? ""} onChange={(e) => set("items", f.items.map((x: any, j: number) => (j === i ? { ...x, description: e.target.value } : x)))} /></Field>
                <Field label="Packages"><input type="number" min="0" value={it.packages ?? ""} onChange={(e) => set("items", f.items.map((x: any, j: number) => (j === i ? { ...x, packages: e.target.value } : x)))} /></Field>
                <Field label="Consignor invoice no."><input value={it.invoiceRef ?? ""} onChange={(e) => set("items", f.items.map((x: any, j: number) => (j === i ? { ...x, invoiceRef: e.target.value } : x)))} /></Field>
                <Field label="Value (₹)"><div className="row"><input type="number" min="0" step="0.01" value={it.value ?? ""} onChange={(e) => set("items", f.items.map((x: any, j: number) => (j === i ? { ...x, value: e.target.value } : x)))} style={{ flex: 1 }} /><button type="button" className="btn-sm" onClick={() => set("items", f.items.filter((_: any, j: number) => j !== i))}>✕</button></div></Field>
              </div>
            ))}
            <button type="button" className="btn-sm" onClick={() => set("items", [...(f.items ?? []), {}])}>+ Add item</button>
          </div>
          <div className="form-section"><Field label="Remarks" wide><textarea value={f.remarks ?? ""} onChange={(e) => set("remarks", e.target.value)} /></Field></div>
        </div>
        {can("profit.view") && p && (
          <div className="card" style={{ alignSelf: "start", position: "sticky", top: 70 }}>
            <h2>Profit / Loss (live)</h2>
            <ProfitTable p={p} />
          </div>
        )}
      </div>
    </form>
  );
}

export function ProfitTable({ p }: { p: any }) {
  const rows: [string, number][] = [["Transporter hire", p.hire], ["Loading", p.loading], ["Unloading", p.unloading], ["Diesel", p.diesel], ["Toll", p.toll], ["RTO", p.rto], ["Driver bata", p.driverBata], ["Other expense", p.otherExpense]];
  if (p.linkedExpenses) rows.push(["Expense entries", p.linkedExpenses]);
  return (
    <table>
      <tbody>
        <tr><td>Revenue (freight)</td><td className="num"><b>{money(p.revenue)}</b></td></tr>
        {rows.map(([k, v]) => <tr key={k}><td className="muted">− {k}</td><td className="num">{money(v)}</td></tr>)}
        <tr><td>Total cost</td><td className="num">{money(p.totalCost)}</td></tr>
        <tr><td><b>{p.profit < 0 ? "NET LOSS" : "NET PROFIT"}</b></td><td className="num"><b><Money v={p.profit} color /></b></td></tr>
        <tr><td>Profit %</td><td className="num">{p.profitPct}%</td></tr>
        <tr><td>Revenue / KM</td><td className="num">{p.revenuePerKm === null ? "—" : money(p.revenuePerKm, 2)}</td></tr>
        <tr><td>Cost / KM</td><td className="num">{p.costPerKm === null ? "—" : money(p.costPerKm, 2)}</td></tr>
        <tr><td>Profit / KM</td><td className="num">{p.profitPerKm === null ? "—" : money(p.profitPerKm, 2)}</td></tr>
        <tr><td className="muted">Hire balance (hire − advance)</td><td className="num">{money(p.hireBalance)}</td></tr>
      </tbody>
      <tfoot><tr><td colSpan={2} className="formula" style={{ fontWeight: 400 }}>{p.formula}</td></tr></tfoot>
    </table>
  );
}

const NEXT: Record<string, string[]> = {
  BOOKED: ["ALLOCATED", "LOADED"], ALLOCATED: ["LOADED"], LOADED: ["IN TRANSIT"], "IN TRANSIT": ["DELIVERED"], DELIVERED: ["POD RECEIVED"],
  "POD RECEIVED": [], BILLED: ["CLOSED"], SETTLED: ["CLOSED"], CLOSED: [], CANCELLED: [],
};

export function TripDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data: t, error, reload } = useLoad(() => api.get(`/trips/${id}`), [id]);
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState("");
  const { busy, run } = useAction();
  if (!t) return <Loading error={error} />;
  const inv = t.invoiceItems?.find((i: any) => i.invoice.status !== "CANCELLED")?.invoice;
  const setStatus = (status: string) => run(() => api.post(`/trips/${t.id}/status`, { status, date: todayIst() }), `Status: ${status}`).then((r) => r && reload());
  return (
    <>
      <PageHead title={`Trip ${t.tripNumber}`} sub={<>{displayDate(t.tripDate)} · {t.customer.name} · <Badge s={t.status} /></>}>
        {can("trips.edit") && t.status !== "CANCELLED" && NEXT[t.status]?.map((s) => <button key={s} className="btn-green" disabled={busy} onClick={() => setStatus(s)}>Mark {s}</button>)}
        {can("trips.edit") && t.status !== "CANCELLED" && <Link className="btn" to={`/trips/${t.id}/edit`}>Edit</Link>}
        {can("billing.edit") && !inv && t.status !== "CANCELLED" && <Link className="btn" to={`/billing/new?customerId=${t.customerId}&tripId=${t.id}`}>Create invoice</Link>}
        {can("trips.cancel") && t.status !== "CANCELLED" && !inv && <button className="btn-danger" onClick={() => setCancel(true)}>Cancel trip</button>}
      </PageHead>
      {t.status === "CANCELLED" && <div className="alert red">Cancelled: {t.cancelReason}</div>}
      <div className="grid g3">
        <div className="card" style={{ gridColumn: "span 2" }}>
          <dl className="kv">
            <dt>Customer</dt><dd><Link to={`/masters/customers/${t.customerId}`}>{t.customer.name}</Link></dd>
            <dt>Route</dt><dd>{t.loadingPoint?.name ?? "—"} → {t.deliveryPoint?.name ?? "—"} {t.distanceKm ? `(${t.distanceKm} km)` : ""}</dd>
            <dt>Transporter</dt><dd>{t.transporter?.name ?? "—"}</dd>
            <dt>Vehicle</dt><dd>{t.vehicle?.vehicleNumber ?? "—"}</dd>
            <dt>Driver</dt><dd>{t.driver ? `${t.driver.name} ${t.driver.mobile ?? ""}` : "—"}</dd>
            <dt>Material</dt><dd>{t.material ?? "—"} {t.quantity ? `· ${t.quantity} ${t.unit ?? ""}` : ""} {t.weightTons ? `· ${t.weightTons} t` : ""}</dd>
            <dt>LR</dt><dd>{t.lrNumber ?? "—"} {t.lrDate ? `dt ${displayDate(t.lrDate)}` : ""}</dd>
            <dt>E-Way Bill</dt><dd>{t.ewayBillNumber ?? "—"} {t.ewayBillExpiry ? `valid till ${displayDate(t.ewayBillExpiry)}` : ""}</dd>
            <dt>Delivered</dt><dd>{displayDate(t.deliveredDate) || "—"}</dd>
            <dt>POD received</dt><dd>{displayDate(t.podReceivedDate) || "—"}</dd>
            <dt>Invoice</dt><dd>{inv ? <Link to={`/billing/invoices/${inv.id}`}>{inv.invoiceNumber}</Link> : "Not billed"}</dd>
            <dt>Remarks</dt><dd>{t.remarks ?? "—"}</dd>
            <dt>Created by</dt><dd>{t.createdBy ?? "—"}</dd>
          </dl>
          {t.items?.length > 0 && (
            <div className="form-section"><h3>Consignment items</h3>
              <div className="table-wrap"><table><thead><tr><th>#</th><th>Description</th><th>Packages</th><th>Invoice ref</th><th className="num">Value</th></tr></thead>
                <tbody>{t.items.map((i: any) => <tr key={i.id}><td>{i.lineNo}</td><td>{i.description}</td><td>{i.packages}</td><td>{i.invoiceRef}</td><td className="num">{i.value ? money(i.value) : ""}</td></tr>)}</tbody></table></div>
            </div>
          )}
          <div className="form-section"><h3>Documents (LR, POD, E-Way Bill…)</h3>
            <DocUpload entityType="TRIP" entityId={t.id} defaultType={["DELIVERED", "IN TRANSIT"].includes(t.status) ? "POD" : "LR"} onDone={reload} />
            <div style={{ marginTop: 10 }}><DocList docs={t.documents} /></div>
          </div>
          <div className="form-section"><div className="spread"><h3>Expense entries</h3>{can("expenses.edit") && <Link to={`/expenses/new?tripId=${t.id}`}>+ Add expense</Link>}</div>
            {t.expenses.length === 0 ? <div className="muted small">None</div> : (
              <div className="table-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Paid to</th><th>Status</th><th className="num">Amount</th></tr></thead>
                <tbody>{t.expenses.map((e: any) => <tr key={e.id}><td>{displayDate(e.expenseDate)}</td><td>{e.category}</td><td>{e.payee}</td><td><Badge s={e.status === "CANCELLED" ? "CANCELLED" : e.paymentStatus} /></td><td className="num">{money(e.amount)}</td></tr>)}</tbody></table></div>
            )}
          </div>
        </div>
        <div>
          {t.profitDetail && <div className="card"><h2>Profit / Loss</h2><ProfitTable p={t.profitDetail} /></div>}
          {t.settlement && (
            <div className="card">
              <div className="spread"><h2>Transporter settlement</h2><Badge s={t.settlement.status} /></div>
              <dl className="kv">
                <dt>Settlement</dt><dd>{t.settlement.code}</dd>
                <dt>Hire</dt><dd>{money(t.transporterHire)}</dd>
                <dt>Advance</dt><dd>{money(t.advance)}</dd>
                <dt>Deductions</dt><dd>{money(t.settlement.deductions)} {t.settlement.deductionNote ?? ""}</dd>
                <dt>Paid</dt><dd>{money(t.settlement.payments.filter((p: any) => p.status === "ACTIVE").reduce((a: number, p: any) => a + Number(p.amount), 0))}</dd>
              </dl>
              {can("settlements.edit") && t.settlement.status !== "PAID" && t.settlement.status !== "CANCELLED" && <Link className="btn btn-sm" style={{ marginTop: 10 }} to={`/payments?tab=settlements&settle=${t.settlement.id}`}>Pay transporter</Link>}
            </div>
          )}
        </div>
      </div>
      {cancel && (
        <Modal title={`Cancel ${t.tripNumber}`} onClose={() => setCancel(false)} footer={<><button onClick={() => setCancel(false)}>Back</button><button className="btn-danger" disabled={busy || reason.trim().length < 3} onClick={() => run(() => api.post(`/trips/${t.id}/cancel`, { reason }), "Trip cancelled").then((r) => { if (r) { setCancel(false); reload(); } })}>Cancel trip</button></>}>
          <p>The trip stays in the records (nothing is deleted) and is excluded from revenue and profit.</p>
          <Field label="Reason *"><input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </Modal>
      )}
    </>
  );
}
