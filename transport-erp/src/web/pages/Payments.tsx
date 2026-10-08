import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { displayDate, money, todayIst } from "../format";
import { Badge, Field, Loading, MasterSelect, Modal, PageHead, Pager, Tabs, useAction, useLoad } from "../components/ui";
import { ReceiptModal } from "./Billing";

type Tab = "receipts" | "settlements" | "transporterPayments" | "receivables" | "payables";

export function PaymentsPage() {
  const [sp, setSp] = useSearchParams();
  const { can } = useAuth();
  const tab = (sp.get("tab") as Tab) ?? "receipts";
  const tabs: { key: Tab; label: string }[] = [
    { key: "receipts", label: "Customer receipts" },
    ...(can("settlements.view") ? [{ key: "settlements" as Tab, label: "Transporter settlements" }, { key: "transporterPayments" as Tab, label: "Transporter payments" }] : []),
    { key: "receivables", label: "Receivables" },
    ...(can("settlements.view") ? [{ key: "payables" as Tab, label: "Payables" }] : []),
  ];
  return (
    <>
      <PageHead title="Payments" />
      <Tabs tabs={tabs} value={tab} onChange={(t) => setSp({ tab: t })} />
      {tab === "receipts" && <Receipts openNew={sp.get("new") === "1"} />}
      {tab === "settlements" && <Settlements settleId={sp.get("settle")} />}
      {tab === "transporterPayments" && <TransporterPayments />}
      {tab === "receivables" && <Receivables />}
      {tab === "payables" && <Payables />}
    </>
  );
}

function Receipts({ openNew }: { openNew: boolean }) {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [show, setShow] = useState(openNew);
  const { data, error, reload } = useLoad(() => api.get("/receipts", { page, pageSize: 25 }), [page]);
  const { run } = useAction();
  return (
    <>
      <div className="spread" style={{ marginBottom: 10 }}><span className="muted">Payments received from customers</span>{can("billing.edit") && <button className="btn-primary" onClick={() => setShow(true)}>+ Record payment</button>}</div>
      {!data ? <Loading error={error} /> : (
        <>
          <div className="table-wrap"><table>
            <thead><tr><th>Receipt</th><th>Date</th><th>Customer</th><th>Invoice</th><th className="hide-mobile">Mode / Ref</th><th className="num">Amount</th><th className="num">TDS</th><th>Status</th><th></th></tr></thead>
            <tbody>{data.rows.map((r: any) => (
              <tr key={r.id}>
                <td>{r.code}</td><td>{displayDate(r.receiptDate)}</td><td>{r.customer.name}</td>
                <td>{r.invoice ? <Link to={`/billing/invoices/${r.invoice.id}`}>{r.invoice.invoiceNumber}</Link> : <span className="muted">On account</span>}</td>
                <td className="hide-mobile">{r.mode} {r.reference}</td><td className="num">{money(r.amount, 2)}</td><td className="num">{money(r.tdsAmount, 2)}</td><td><Badge s={r.status} /></td>
                <td>{r.status === "ACTIVE" && can("billing.edit") && <button className="btn-sm" onClick={() => confirm(`Cancel receipt ${r.code}?`) && run(() => api.post(`/receipts/${r.id}/cancel`), "Cancelled").then(reload)}>Cancel</button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <Pager page={page} pageSize={25} total={data.total} onPage={setPage} />
        </>
      )}
      {show && <ReceiptModal onClose={() => setShow(false)} onDone={reload} />}
    </>
  );
}

function PayModal({ settlement, onClose, onDone }: { settlement?: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<any>({ transporterId: settlement?.transporterId ?? "", settlementId: settlement?.id ?? "", paymentDate: todayIst(), amount: settlement?.balance ?? "", mode: "NEFT", reference: "" });
  const { busy, run } = useAction();
  const save = async () => { const r = await run(() => api.post("/transporter-payments", f), "Payment saved"); if (r) { onDone(); onClose(); } };
  return (
    <Modal title={settlement ? `Pay ${settlement.transporter.name} for ${settlement.trip.tripNumber}` : "Transporter payment"} onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy} onClick={save}>Save payment</button></>}>
      {settlement && <div className="alert blue">Hire {money(settlement.hire)} − advance {money(settlement.advance)} − deductions {money(settlement.deductions)} − paid {money(settlement.paid)} = balance <b>{money(settlement.balance)}</b></div>}
      <div className="form-grid">
        {!settlement && <Field label="Transporter *"><MasterSelect kind="transporters" value={f.transporterId} onChange={(v) => setF({ ...f, transporterId: v })} /></Field>}
        <Field label="Date *"><input type="date" value={f.paymentDate} onChange={(e) => setF({ ...f, paymentDate: e.target.value })} /></Field>
        <Field label="Amount (₹) *"><input type="number" min="0" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Mode"><select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>{["NEFT", "RTGS", "UPI", "BANK", "CHEQUE", "CASH"].map((m) => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Reference"><input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function Settlements({ settleId }: { settleId: string | null }) {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("PENDING,PARTIAL");
  const [transporterId, setT] = useState("");
  const { data, error, reload } = useLoad(() => api.get("/settlements", { page, pageSize: 25, status, transporterId }), [page, status, transporterId]);
  const one = useLoad(() => (settleId ? api.get(`/settlements/${settleId}`) : Promise.resolve(null)), [settleId]);
  const [pay, setPay] = useState<any>(null);
  const [ded, setDed] = useState<any>(null);
  const { busy, run } = useAction();
  useEffect(() => { if (one.data && one.data.status !== "PAID" && one.data.status !== "CANCELLED") setPay(one.data); }, [one.data]);
  return (
    <>
      <div className="filters">
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status"><option value="PENDING,PARTIAL">Open (pending / partial)</option><option value="PAID">Paid</option><option value="CANCELLED">Cancelled</option><option value="">All</option></select>
        <div style={{ minWidth: 220 }}><MasterSelect kind="transporters" value={transporterId} onChange={(v) => { setT(v); setPage(1); }} placeholder="All transporters" /></div>
      </div>
      {!data ? <Loading error={error} /> : (
        <>
          <div className="table-wrap"><table>
            <thead><tr><th>Settlement</th><th>Trip</th><th>Transporter</th><th className="num">Hire</th><th className="num">Advance</th><th className="num">Deductions</th><th className="num">Paid</th><th className="num">Balance</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {data.rows.length === 0 && <tr><td colSpan={10} className="empty">Nothing here</td></tr>}
              {data.rows.map((s: any) => (
                <tr key={s.id}>
                  <td>{s.code}</td><td><Link to={`/trips/${s.trip.id}`}>{s.trip.tripNumber}</Link><div className="muted small">{displayDate(s.trip.tripDate)} {s.trip.vehicle?.vehicleNumber}</div></td>
                  <td>{s.transporter.name}</td><td className="num">{money(s.hire)}</td><td className="num">{money(s.advance)}</td><td className="num">{money(s.deductions)}</td><td className="num">{money(s.paid)}</td><td className="num"><b>{money(s.balance)}</b></td><td><Badge s={s.status} /></td>
                  <td className="nowrap">{can("settlements.edit") && s.status !== "PAID" && s.status !== "CANCELLED" && <><button className="btn-sm btn-primary" onClick={() => setPay(s)}>Pay</button> <button className="btn-sm" onClick={() => setDed({ ...s })}>Deduct</button></>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <Pager page={page} pageSize={25} total={data.total} onPage={setPage} />
        </>
      )}
      {pay && <PayModal settlement={pay} onClose={() => setPay(null)} onDone={reload} />}
      {ded && (
        <Modal title={`Deductions for ${ded.code}`} onClose={() => setDed(null)} footer={<><button onClick={() => setDed(null)}>Cancel</button><button className="btn-primary" disabled={busy} onClick={() => run(() => api.put(`/settlements/${ded.id}/deductions`, ded), "Saved").then((r) => { if (r) { setDed(null); reload(); } })}>Save</button></>}>
          <div className="form-grid">
            <Field label="Deductions (₹)"><input type="number" min="0" step="0.01" value={ded.deductions} onChange={(e) => setDed({ ...ded, deductions: e.target.value })} /></Field>
            <Field label="Reason (shortage, damage, late delivery…)"><input value={ded.deductionNote ?? ""} onChange={(e) => setDed({ ...ded, deductionNote: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}

function TransporterPayments() {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [show, setShow] = useState(false);
  const { data, error, reload } = useLoad(() => api.get("/transporter-payments", { page, pageSize: 25 }), [page]);
  const { run } = useAction();
  return (
    <>
      <div className="spread" style={{ marginBottom: 10 }}><span className="muted">Pay against a settlement from the Settlements tab, or record an on-account payment here.</span>{can("settlements.edit") && <button className="btn-primary" onClick={() => setShow(true)}>+ On-account payment</button>}</div>
      {!data ? <Loading error={error} /> : (
        <>
          <div className="table-wrap"><table>
            <thead><tr><th>Payment</th><th>Date</th><th>Transporter</th><th>Settlement / Trip</th><th className="hide-mobile">Mode / Ref</th><th className="num">Amount</th><th>Status</th><th></th></tr></thead>
            <tbody>{data.rows.map((p: any) => (
              <tr key={p.id}>
                <td>{p.code}</td><td>{displayDate(p.paymentDate)}</td><td>{p.transporter.name}</td><td>{p.settlement ? `${p.settlement.code} · ${p.settlement.trip.tripNumber}` : <span className="muted">On account</span>}</td>
                <td className="hide-mobile">{p.mode} {p.reference}</td><td className="num">{money(p.amount, 2)}</td><td><Badge s={p.status} /></td>
                <td>{p.status === "ACTIVE" && can("settlements.edit") && <button className="btn-sm" onClick={() => confirm(`Cancel payment ${p.code}?`) && run(() => api.post(`/transporter-payments/${p.id}/cancel`), "Cancelled").then(reload)}>Cancel</button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <Pager page={page} pageSize={25} total={data.total} onPage={setPage} />
        </>
      )}
      {show && <PayModal onClose={() => setShow(false)} onDone={reload} />}
    </>
  );
}

const AGE = ["0-30", "31-60", "61-90", "90+"];
function Receivables() {
  const { data, error } = useLoad(() => api.get("/receivables"), []);
  if (!data) return <Loading error={error} />;
  return (
    <>
      <div className="kpis" style={{ marginBottom: 12 }}>
        <div className="kpi blue"><div className="label">Total receivable</div><div className="value">{money(data.totals.total ?? 0)}</div></div>
        {AGE.map((a) => <div key={a} className={`kpi ${a === "90+" ? "red" : a === "61-90" ? "amber" : ""}`}><div className="label">{a} days</div><div className="value">{money(data.totals[a] ?? 0)}</div></div>)}
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Customer</th><th className="hide-mobile">Mobile</th>{AGE.map((a) => <th key={a} className="num">{a}</th>)}<th className="num">Total</th></tr></thead>
        <tbody>{data.rows.map((r: any) => <tr key={r.customerId}><td><Link to={`/masters/customers/${r.customerId}`}>{r.name}</Link></td><td className="hide-mobile">{r.mobile}</td>{AGE.map((a) => <td key={a} className="num">{r[a] ? money(r[a]) : ""}</td>)}<td className="num"><b>{money(r.total)}</b></td></tr>)}</tbody>
      </table></div>
      <p className="muted small">Ageing by invoice date as of {displayDate(data.asOf)}. Opening balances count as 90+; on-account receipts reduce the oldest amounts first.</p>
    </>
  );
}

function Payables() {
  const { data, error } = useLoad(() => api.get("/payables"), []);
  if (!data) return <Loading error={error} />;
  return (
    <>
      <div className="kpis" style={{ marginBottom: 12 }}>
        <div className="kpi red"><div className="label">Total payable</div><div className="value">{money(data.total)}</div></div>
        <div className="kpi"><div className="label">Transporter payable</div><div className="value">{money(data.transporter.total)}</div></div>
        <div className="kpi"><div className="label">Driver payable</div><div className="value">{money(data.driver.total)}</div></div>
        <div className="kpi"><div className="label">Other payable</div><div className="value">{money(data.other.total)}</div></div>
      </div>
      <div className="grid g2">
        <div className="card"><h2>Transporters</h2><div className="table-wrap"><table>
          <thead><tr><th>Transporter</th>{AGE.map((a) => <th key={a} className="num hide-mobile">{a}</th>)}<th className="num">Total</th></tr></thead>
          <tbody>{data.transporter.rows.map((r: any) => <tr key={r.transporterId}><td><Link to={`/payments?tab=settlements`}>{r.name}</Link></td>{AGE.map((a) => <td key={a} className="num hide-mobile">{r[a] ? money(r[a]) : ""}</td>)}<td className="num"><b>{money(r.total)}</b></td></tr>)}</tbody>
        </table></div></div>
        <div>
          <div className="card"><h2>Drivers (unpaid expense entries)</h2><table><tbody>{data.driver.rows.map((r: any) => <tr key={r.driverId}><td>{r.name}</td><td>{r.count} entries</td><td className="num">{money(r.total)}</td></tr>)}</tbody></table>{data.driver.rows.length === 0 && <div className="muted">None</div>}</div>
          <div className="card"><h2>Other (unpaid expense entries)</h2><table><tbody>{data.other.rows.map((r: any) => <tr key={r.payee}><td>{r.payee}</td><td>{r.count} entries</td><td className="num">{money(r.total)}</td></tr>)}</tbody></table>{data.other.rows.length === 0 && <div className="muted">None</div>}<p className="small"><Link to="/expenses?paymentStatus=UNPAID">Mark expenses paid</Link></p></div>
        </div>
      </div>
    </>
  );
}
