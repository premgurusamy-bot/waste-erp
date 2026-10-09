import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { displayDate, money, todayIst } from "../format";
import { computeGst, type GstType } from "../../shared/calc";
import { Badge, Field, Loading, MasterSelect, Modal, PageHead, Pager, useAction, useLoad } from "../components/ui";

export function InvoicesPage() {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const q = Object.fromEntries(sp.entries());
  const { data, error } = useLoad(() => api.get("/invoices", { ...q, pageSize: 25 }), [sp.toString()]);
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); n.delete("page"); setSp(n); };
  return (
    <>
      <PageHead title="Billing" sub="Customer invoices">
        <Link className="btn" to="/payments">Receipts &amp; payments</Link>
        {can("billing.edit") && <Link className="btn btn-primary" to="/billing/new">+ New Invoice</Link>}
      </PageHead>
      <div className="filters">
        <input placeholder="Invoice no or customer" defaultValue={q.q ?? ""} onKeyDown={(e) => e.key === "Enter" && set("q", (e.target as HTMLInputElement).value)} />
        <div style={{ minWidth: 200 }}><MasterSelect kind="customers" value={q.customerId} onChange={(v) => set("customerId", v)} placeholder="All customers" /></div>
        <input type="date" value={q.from ?? ""} onChange={(e) => set("from", e.target.value)} aria-label="From" />
        <input type="date" value={q.to ?? ""} onChange={(e) => set("to", e.target.value)} aria-label="To" />
      </div>
      {!data ? <Loading error={error} /> : (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th className="hide-mobile">Trips</th><th className="hide-mobile">GST</th><th className="num">Total</th><th className="num">Paid</th><th className="num">Balance</th><th>Status</th></tr></thead>
              <tbody>
                {data.rows.length === 0 && <tr><td colSpan={9} className="empty">No invoices</td></tr>}
                {data.rows.map((r: any) => (
                  <tr key={r.id}>
                    <td><Link to={`/billing/invoices/${r.id}`}><b>{r.invoiceNumber}</b></Link></td>
                    <td className="nowrap">{displayDate(r.invoiceDate)}</td>
                    <td>{r.customer.name}</td>
                    <td className="hide-mobile">{r._count.items}</td>
                    <td className="hide-mobile">{r.gstType === "NONE" ? "—" : `${r.gstType.replace("_", "+")} ${r.gstRate}%`}</td>
                    <td className="num">{money(r.total)}</td>
                    <td className="num">{money(r.received)}</td>
                    <td className="num"><b>{money(r.balance)}</b></td>
                    <td><Badge s={r.payState} /></td>
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

export function NewInvoicePage() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const settings = useLoad(() => api.get("/settings").catch(() => ({})), []);
  const [customerId, setCustomerId] = useState(sp.get("customerId") ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set(sp.get("tripId") ? [sp.get("tripId")!] : []));
  const [f, setF] = useState<any>({ invoiceDate: todayIst(), otherCharges: 0, otherChargesLabel: "Other charges", gstType: "NONE", gstRate: 0, notes: "" });
  const trips = useLoad(() => (customerId ? api.get(`/invoices/billable/${customerId}`) : Promise.resolve([])), [customerId]);
  const { busy, run } = useAction();
  useEffect(() => { if (settings.data) setF((x: any) => ({ ...x, gstType: settings.data["gst.defaultType"] ?? "NONE", gstRate: Number(settings.data["gst.defaultRate"] ?? 0) })); }, [settings.data]);
  const freight = useMemo(() => (trips.data ?? []).filter((t: any) => selected.has(t.id)).reduce((a: number, t: any) => a + Number(t.customerFreight), 0), [trips.data, selected]);
  const gst = computeGst(freight + Number(f.otherCharges || 0), f.gstType as GstType, f.gstType === "NONE" ? 0 : Number(f.gstRate || 0));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const save = async () => {
    const r = await run(() => api.post("/invoices", { ...f, customerId, tripIds: [...selected] }), "Invoice created");
    if (r) nav(`/billing/invoices/${r.id}`);
  };
  return (
    <>
      <PageHead title="New Invoice"><button onClick={() => nav(-1)}>Cancel</button><button className="btn-primary" disabled={busy || !selected.size} onClick={save}>Create invoice</button></PageHead>
      <div className="grid g3">
        <div className="card" style={{ gridColumn: "span 2" }}>
          <div className="form-grid">
            <Field label="Customer *"><MasterSelect kind="customers" value={customerId} onChange={(v) => { setCustomerId(v); setSelected(new Set()); }} /></Field>
            <Field label="Invoice date *"><input type="date" value={f.invoiceDate} onChange={(e) => setF({ ...f, invoiceDate: e.target.value })} /></Field>
            <Field label="Due date (blank = credit days)"><input type="date" value={f.dueDate ?? ""} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
          </div>
          <div className="form-section"><h3>Trips to bill ({selected.size} selected)</h3>
            {!customerId ? <div className="muted">Choose a customer.</div> : !trips.data ? <Loading /> : trips.data.length === 0 ? <div className="muted">No unbilled trips for this customer.</div> : (
              <div className="table-wrap"><table>
                <thead><tr><th><input type="checkbox" aria-label="All" checked={selected.size === trips.data.length} onChange={(e) => setSelected(new Set(e.target.checked ? trips.data.map((t: any) => t.id) : []))} /></th><th>Trip</th><th>Date</th><th>Route</th><th>Vehicle</th><th>LR</th><th>Status</th><th className="num">Freight</th></tr></thead>
                <tbody>{trips.data.map((t: any) => (
                  <tr key={t.id} onClick={() => toggle(t.id)} style={{ cursor: "pointer" }}>
                    <td><input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} onClick={(e) => e.stopPropagation()} aria-label={t.tripNumber} /></td>
                    <td>{t.tripNumber}</td><td>{displayDate(t.tripDate)}</td><td>{t.loadingPoint?.name} → {t.deliveryPoint?.name}</td><td>{t.vehicle?.vehicleNumber}</td><td>{t.lrNumber}</td><td><Badge s={t.status} /></td><td className="num">{money(t.customerFreight)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </div>
          <div className="form-section"><h3>Charges and GST</h3>
            <div className="form-grid">
              <Field label="Other charges (₹)"><input type="number" min="0" step="0.01" value={f.otherCharges} onChange={(e) => setF({ ...f, otherCharges: e.target.value })} /></Field>
              <Field label="Other charges description"><input value={f.otherChargesLabel} onChange={(e) => setF({ ...f, otherChargesLabel: e.target.value })} /></Field>
              <Field label="GST treatment"><select value={f.gstType} onChange={(e) => setF({ ...f, gstType: e.target.value })}>
                <option value="NONE">No GST</option><option value="CGST_SGST">CGST + SGST (intra-state)</option><option value="IGST">IGST (inter-state)</option><option value="RCM">Reverse charge (recipient pays)</option>
              </select></Field>
              <Field label="GST rate %"><select value={f.gstRate} disabled={f.gstType === "NONE"} onChange={(e) => setF({ ...f, gstRate: Number(e.target.value) })}>{[0, 5, 12, 18].map((r) => <option key={r} value={r}>{r}%</option>)}</select></Field>
              <Field label="Place of supply"><input value={f.placeOfSupply ?? ""} onChange={(e) => setF({ ...f, placeOfSupply: e.target.value })} placeholder="Defaults to customer state" /></Field>
              <Field label="Notes" wide><textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
            </div>
            <div className="muted small">GST is never assumed: choose the treatment that applies to this customer (your accountant can confirm).</div>
          </div>
        </div>
        <div className="card" style={{ alignSelf: "start" }}>
          <h2>Invoice total</h2>
          <table><tbody>
            <tr><td>Freight</td><td className="num">{money(freight, 2)}</td></tr>
            <tr><td>Other charges</td><td className="num">{money(f.otherCharges, 2)}</td></tr>
            <tr><td>Taxable value</td><td className="num">{money(gst.taxable, 2)}</td></tr>
            {gst.cgst > 0 && <tr><td>CGST</td><td className="num">{money(gst.cgst, 2)}</td></tr>}
            {gst.sgst > 0 && <tr><td>SGST</td><td className="num">{money(gst.sgst, 2)}</td></tr>}
            {gst.igst > 0 && <tr><td>IGST</td><td className="num">{money(gst.igst, 2)}</td></tr>}
            <tr><td>Round off</td><td className="num">{money(gst.roundOff, 2)}</td></tr>
            <tr><td><b>TOTAL</b></td><td className="num"><b>{money(gst.total, 2)}</b></td></tr>
          </tbody></table>
        </div>
      </div>
    </>
  );
}

export function ReceiptModal({ customerId, invoice, onClose, onDone }: { customerId?: string; invoice?: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<any>({ customerId: customerId ?? invoice?.customerId ?? "", invoiceId: invoice?.id ?? "", receiptDate: todayIst(), amount: invoice ? invoice.balance : "", tdsAmount: 0, mode: "BANK", reference: "" });
  const invoices = useLoad(() => (f.customerId && !invoice ? api.get("/invoices", { customerId: f.customerId, pageSize: 100 }) : Promise.resolve({ rows: [] })), [f.customerId]);
  const { busy, run } = useAction();
  const save = async () => { const r = await run(() => api.post("/receipts", f), "Receipt saved"); if (r) { onDone(); onClose(); } };
  return (
    <Modal title="Record customer payment" onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy} onClick={save}>Save receipt</button></>}>
      <div className="form-grid">
        {!invoice && <Field label="Customer *"><MasterSelect kind="customers" value={f.customerId} onChange={(v) => setF({ ...f, customerId: v, invoiceId: "" })} /></Field>}
        {!invoice && <Field label="Against invoice"><select value={f.invoiceId} onChange={(e) => { const i = invoices.data?.rows.find((x: any) => x.id === e.target.value); setF({ ...f, invoiceId: e.target.value, amount: i ? i.balance : f.amount }); }}>
          <option value="">On account (no invoice)</option>
          {invoices.data?.rows.filter((i: any) => i.balance > 0).map((i: any) => <option key={i.id} value={i.id}>{i.invoiceNumber} · balance {money(i.balance)}</option>)}
        </select></Field>}
        {invoice && <Field label="Invoice"><input disabled value={`${invoice.invoiceNumber} · balance ${money(invoice.balance)}`} /></Field>}
        <Field label="Date *"><input type="date" value={f.receiptDate} onChange={(e) => setF({ ...f, receiptDate: e.target.value })} /></Field>
        <Field label="Amount received (₹) *"><input type="number" min="0" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="TDS deducted (₹)"><input type="number" min="0" step="0.01" value={f.tdsAmount} onChange={(e) => setF({ ...f, tdsAmount: e.target.value })} /></Field>
        <Field label="Mode"><select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>{["BANK", "NEFT", "RTGS", "UPI", "CHEQUE", "CASH"].map((m) => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Reference (UTR / cheque)"><input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export function InvoiceDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data: inv, error, reload } = useLoad(() => api.get(`/invoices/${id}`), [id]);
  const [pay, setPay] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState("");
  const { busy, run } = useAction();
  if (!inv) return <Loading error={error} />;
  return (
    <>
      <PageHead title={`Invoice ${inv.invoiceNumber}`} sub={<>{displayDate(inv.invoiceDate)} · {inv.customer.name} · <Badge s={inv.payState} /></>}>
        <a className="btn" href={`/api/invoices/${inv.id}/pdf`} target="_blank" rel="noopener noreferrer">PDF / Print</a>
        {can("billing.edit") && inv.status !== "CANCELLED" && inv.balance > 0 && <button className="btn-primary" onClick={() => setPay(true)}>Record payment</button>}
        {can("billing.edit") && inv.status !== "CANCELLED" && <button className="btn-danger" onClick={() => setCancel(true)}>Cancel invoice</button>}
      </PageHead>
      <div className="grid g3">
        <div className="card" style={{ gridColumn: "span 2" }}>
          <div className="table-wrap"><table>
            <thead><tr><th>#</th><th>Description</th><th>SAC</th><th className="num">Amount</th></tr></thead>
            <tbody>{inv.items.map((i: any) => <tr key={i.id}><td>{i.lineNo}</td><td>{i.trip ? <Link to={`/trips/${i.tripId}`}>{i.description}</Link> : i.description}</td><td>{i.sacCode}</td><td className="num">{money(i.amount, 2)}</td></tr>)}</tbody>
          </table></div>
          <div className="form-section"><h3>Payments received</h3>
            {inv.receipts.length === 0 ? <div className="muted">None yet</div> : (
              <div className="table-wrap"><table><thead><tr><th>Receipt</th><th>Date</th><th>Mode</th><th>Reference</th><th className="num">Amount</th><th className="num">TDS</th><th></th></tr></thead>
                <tbody>{inv.receipts.map((r: any) => <tr key={r.id}><td>{r.code}</td><td>{displayDate(r.receiptDate)}</td><td>{r.mode}</td><td>{r.reference}</td><td className="num">{money(r.amount, 2)}</td><td className="num">{money(r.tdsAmount, 2)}</td><td>{r.status === "CANCELLED" ? <Badge s="CANCELLED" /> : can("billing.edit") && <button className="btn-sm" onClick={() => confirm(`Cancel receipt ${r.code}?`) && run(() => api.post(`/receipts/${r.id}/cancel`), "Receipt cancelled").then(reload)}>Cancel</button>}</td></tr>)}</tbody></table></div>
            )}
          </div>
        </div>
        <div className="card" style={{ alignSelf: "start" }}>
          <table><tbody>
            <tr><td>Freight</td><td className="num">{money(inv.freightAmount, 2)}</td></tr>
            <tr><td>Other charges</td><td className="num">{money(inv.otherCharges, 2)}</td></tr>
            <tr><td>Taxable value</td><td className="num">{money(inv.taxableValue, 2)}</td></tr>
            <tr><td>GST</td><td className="num">{inv.gstType === "NONE" ? "Not charged" : inv.gstType === "RCM" ? `RCM ${inv.gstRate}% (recipient pays)` : `${inv.gstType.replace("_", " + ")} ${inv.gstRate}%`}</td></tr>
            {Number(inv.cgst) > 0 && <tr><td>CGST</td><td className="num">{money(inv.cgst, 2)}</td></tr>}
            {Number(inv.sgst) > 0 && <tr><td>SGST</td><td className="num">{money(inv.sgst, 2)}</td></tr>}
            {Number(inv.igst) > 0 && <tr><td>IGST</td><td className="num">{money(inv.igst, 2)}</td></tr>}
            <tr><td>Round off</td><td className="num">{money(inv.roundOff, 2)}</td></tr>
            <tr><td><b>Total</b></td><td className="num"><b>{money(inv.total, 2)}</b></td></tr>
            <tr><td>Paid</td><td className="num">{money(inv.received, 2)}</td></tr>
            <tr><td><b>Balance</b></td><td className="num"><b>{money(inv.balance, 2)}</b></td></tr>
            <tr><td>Due date</td><td className="num">{displayDate(inv.dueDate)}</td></tr>
          </tbody></table>
          {inv.notes && <p className="muted small" style={{ whiteSpace: "pre-wrap" }}>{inv.notes}</p>}
        </div>
      </div>
      {pay && <ReceiptModal invoice={inv} onClose={() => setPay(false)} onDone={reload} />}
      {cancel && (
        <Modal title={`Cancel ${inv.invoiceNumber}`} onClose={() => setCancel(false)} footer={<><button onClick={() => setCancel(false)}>Back</button><button className="btn-danger" disabled={busy || reason.trim().length < 3} onClick={() => run(() => api.post(`/invoices/${inv.id}/cancel`, { reason }), "Invoice cancelled").then((r) => { if (r) { setCancel(false); reload(); } })}>Cancel invoice</button></>}>
          <p>The invoice is kept and marked CANCELLED; its trips become billable again.</p>
          <Field label="Reason *"><input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </Modal>
      )}
    </>
  );
}
