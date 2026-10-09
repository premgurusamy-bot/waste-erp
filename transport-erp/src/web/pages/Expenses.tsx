import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { displayDate, money, todayIst } from "../format";
import { EXPENSE_CATEGORIES } from "../../shared/calc";
import { Badge, Field, Loading, MasterSelect, PageHead, Pager, useAction, useLoad } from "../components/ui";
import { DocList, DocUpload } from "../components/Docs";

export function ExpensesPage() {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const q = Object.fromEntries(sp.entries());
  const { data, error, reload } = useLoad(() => api.get("/expenses", { ...q, pageSize: 25 }), [sp.toString()]);
  const { run } = useAction();
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); n.delete("page"); setSp(n); };
  return (
    <>
      <PageHead title="Expenses" sub="Trip expenses, vehicle repair and maintenance, office, salary…">{can("expenses.edit") && <Link className="btn btn-primary" to="/expenses/new">+ New Expense</Link>}</PageHead>
      <div className="filters">
        <input placeholder="Search" defaultValue={q.q ?? ""} onKeyDown={(e) => e.key === "Enter" && set("q", (e.target as HTMLInputElement).value)} />
        <select value={q.category ?? ""} onChange={(e) => set("category", e.target.value)} aria-label="Category"><option value="">All categories</option>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
        <select value={q.paymentStatus ?? ""} onChange={(e) => set("paymentStatus", e.target.value)} aria-label="Payment"><option value="">Paid & unpaid</option><option>PAID</option><option>UNPAID</option></select>
        <input type="date" value={q.from ?? ""} onChange={(e) => set("from", e.target.value)} aria-label="From" />
        <input type="date" value={q.to ?? ""} onChange={(e) => set("to", e.target.value)} aria-label="To" />
      </div>
      {!data ? <Loading error={error} /> : (
        <>
          <div className="table-wrap"><table>
            <thead><tr><th>Expense</th><th>Date</th><th>Category</th><th className="hide-mobile">Trip / Vehicle / Driver</th><th className="hide-mobile">Paid to</th><th>Payment</th><th className="num">Amount</th><th></th></tr></thead>
            <tbody>{data.rows.map((e: any) => (
              <tr key={e.id}>
                <td><Link to={`/expenses/${e.id}`}>{e.code}</Link></td><td>{displayDate(e.expenseDate)}</td><td>{e.category}</td>
                <td className="hide-mobile">{e.trip && <Link to={`/trips/${e.trip.id}`}>{e.trip.tripNumber}</Link>} {e.vehicle?.vehicleNumber} {e.driver?.name}</td>
                <td className="hide-mobile">{e.payee}</td><td><Badge s={e.status === "CANCELLED" ? "CANCELLED" : e.paymentStatus} /></td><td className="num">{money(e.amount, 2)}</td>
                <td>{can("expenses.edit") && e.status === "ACTIVE" && e.paymentStatus === "UNPAID" && <button className="btn-sm" onClick={() => run(() => api.post(`/expenses/${e.id}/paid`), "Marked paid").then(reload)}>Mark paid</button>}</td>
              </tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={6}>Total (active, all pages)</td><td className="num">{money(data.totalAmount, 2)}</td><td /></tr></tfoot>
          </table></div>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => set("page", String(p))} />
        </>
      )}
    </>
  );
}

export function ExpenseFormPage() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [f, setF] = useState<any>(id ? null : { expenseDate: todayIst(), category: "DIESEL", paymentMode: "CASH", paymentStatus: "PAID", tripId: sp.get("tripId") ?? "" });
  const { busy, run } = useAction();
  const trips = useLoad(() => api.get("/trips", { pageSize: 100, activeOnly: "" }), []);
  useEffect(() => { if (id) api.get(`/expenses/${id}`).then(setF); }, [id]);
  if (!f) return <Loading />;
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await run(() => (id ? api.put(`/expenses/${id}`, f) : api.post("/expenses", f)), "Expense saved");
    if (r) nav(`/expenses/${r.id}`);
  };
  return (
    <form onSubmit={save}>
      <PageHead title={id ? `Edit ${f.code}` : "New Expense"}><button type="button" onClick={() => nav(-1)}>Cancel</button><button className="btn-primary" disabled={busy}>Save</button></PageHead>
      <div className="card"><div className="form-grid">
        <Field label="Date *"><input type="date" value={f.expenseDate} onChange={(e) => set("expenseDate", e.target.value)} required /></Field>
        <Field label="Category *"><select value={f.category} onChange={(e) => set("category", e.target.value)}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Amount (₹) *"><input type="number" min="0.01" step="0.01" value={f.amount ?? ""} onChange={(e) => set("amount", e.target.value)} required /></Field>
        <Field label="Trip (optional)"><select value={f.tripId ?? ""} onChange={(e) => set("tripId", e.target.value)}>
          <option value="">— not linked to a trip —</option>
          {f.trip && !trips.data?.rows.some((t: any) => t.id === f.tripId) && <option value={f.tripId}>{f.trip.tripNumber}</option>}
          {trips.data?.rows.map((t: any) => <option key={t.id} value={t.id}>{t.tripNumber} · {displayDate(t.tripDate)} · {t.customer?.name}</option>)}
        </select></Field>
        <Field label="Vehicle"><MasterSelect kind="vehicles" value={f.vehicleId} onChange={(v) => set("vehicleId", v)} placeholder="— none —" /></Field>
        <Field label="Driver"><MasterSelect kind="drivers" value={f.driverId} onChange={(v) => set("driverId", v)} placeholder="— none —" /></Field>
        <Field label="Paid to"><input value={f.payee ?? ""} onChange={(e) => set("payee", e.target.value)} /></Field>
        <Field label="Payment mode"><select value={f.paymentMode} onChange={(e) => set("paymentMode", e.target.value)}>{["CASH", "BANK", "UPI", "CHEQUE", "CARD", "FUEL CARD", "CREDIT"].map((m) => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Payment status"><select value={f.paymentStatus} onChange={(e) => set("paymentStatus", e.target.value)}><option>PAID</option><option>UNPAID</option></select></Field>
        <Field label="Reference / bill no"><input value={f.reference ?? ""} onChange={(e) => set("reference", e.target.value)} /></Field>
        <Field label="Description" wide><textarea value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} /></Field>
      </div>
      {!id && <p className="muted small">You can attach the receipt photo after saving.</p>}
      </div>
    </form>
  );
}

export function ExpenseDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data: e, error, reload } = useLoad(() => api.get(`/expenses/${id}`), [id]);
  const { run } = useAction();
  if (!e) return <Loading error={error} />;
  return (
    <>
      <PageHead title={`Expense ${e.code}`} sub={<>{displayDate(e.expenseDate)} · {e.category} · <Badge s={e.status === "CANCELLED" ? "CANCELLED" : e.paymentStatus} /></>}>
        {can("expenses.edit") && e.status === "ACTIVE" && <><Link className="btn" to={`/expenses/${id}/edit`}>Edit</Link><button className="btn-danger" onClick={() => confirm("Cancel this expense? It stays on record but is no longer counted.") && run(() => api.post(`/expenses/${id}/cancel`), "Cancelled").then(reload)}>Cancel</button></>}
      </PageHead>
      <div className="grid g2">
        <div className="card"><dl className="kv">
          <dt>Amount</dt><dd><b>{money(e.amount, 2)}</b></dd>
          <dt>Trip</dt><dd>{e.trip ? <Link to={`/trips/${e.trip.id}`}>{e.trip.tripNumber}</Link> : "—"}</dd>
          <dt>Vehicle</dt><dd>{e.vehicle?.vehicleNumber ?? "—"}</dd><dt>Driver</dt><dd>{e.driver?.name ?? "—"}</dd>
          <dt>Paid to</dt><dd>{e.payee ?? "—"}</dd><dt>Mode</dt><dd>{e.paymentMode}</dd><dt>Reference</dt><dd>{e.reference ?? "—"}</dd>
          <dt>Description</dt><dd>{e.description ?? "—"}</dd><dt>Created by</dt><dd>{e.createdBy}</dd>
        </dl></div>
        <div className="card"><h2>Receipt</h2><DocUpload entityType="EXPENSE" entityId={e.id} defaultType="EXPENSE_RECEIPT" types={["EXPENSE_RECEIPT", "RECEIPT", "OTHER"]} onDone={reload} /><div style={{ marginTop: 10 }}><DocList docs={e.documents} /></div></div>
      </div>
    </>
  );
}
