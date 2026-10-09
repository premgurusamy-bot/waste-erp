import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, download } from "../api";
import { useAuth } from "../auth";
import { displayDate, money, todayIst, periodRange, dateTime } from "../format";
import { Badge, Field, Kpi, Loading, MasterSelect, MeterDetails, Money, PageHead, Pager, TargetGauge, useAction, useLoad } from "../components/ui";
import { DocList, DocUpload, DOC_TYPES } from "../components/Docs";

// ---------------------------------------------------------------- profitability
export function ProfitPage() {
  const month = periodRange("MONTHLY", todayIst());
  const [range, setRange] = useState({ from: month.start, to: todayIst() });
  const { data: p, error } = useLoad(() => api.get("/profit", range), [range.from, range.to]);
  const routes = useLoad(() => api.get("/reports/route-profitability", range), [range.from, range.to]);
  const customers = useLoad(() => api.get("/reports/customer-profitability", range), [range.from, range.to]);
  const preset = (k: string) => {
    const t = todayIst();
    if (k === "today") setRange({ from: t, to: t });
    if (k === "month") setRange({ from: periodRange("MONTHLY", t).start, to: t });
    if (k === "fy") setRange({ from: periodRange("YEARLY", t).start, to: t });
  };
  return (
    <>
      <PageHead title="Profitability" sub="Every figure shows how it is calculated" />
      <div className="filters">
        <button onClick={() => preset("today")}>Today</button><button onClick={() => preset("month")}>This month</button><button onClick={() => preset("fy")}>This financial year</button>
        <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label="From" />
        <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label="To" />
      </div>
      {!p ? <Loading error={error} /> : (
        <>
          <div className="kpis">
            <Kpi label="Revenue" value={money(p.revenue)} sub={`${p.trips} trips`} tone="blue" />
            <Kpi label="Total cost" value={money(p.totalCost)} />
            <Kpi label={p.netProfit < 0 ? "NET LOSS" : "NET PROFIT"} value={<Money v={p.netProfit} color />} tone={p.netProfit < 0 ? "red" : "green"} sub={`${p.profitPct}% of revenue`} />
            <Kpi label="Revenue / KM" value={p.revenuePerKm === null ? "—" : money(p.revenuePerKm, 2)} sub={`${p.distanceKm.toLocaleString("en-IN")} km`} />
            <Kpi label="Cost / KM" value={p.costPerKm === null ? "—" : money(p.costPerKm, 2)} />
            <Kpi label="Profit / KM" value={p.profitPerKm === null ? "—" : money(p.profitPerKm, 2)} />
          </div>
          <div className="grid g2" style={{ marginTop: 16 }}>
            <div className="card">
              <h2>Profit &amp; loss: {displayDate(p.from)} to {displayDate(p.to)}</h2>
              <table><tbody>
                <tr><td><b>Revenue</b> (customer freight)</td><td className="num"><b>{money(p.revenue)}</b></td></tr>
                <tr><td className="muted">− Transporter hire</td><td className="num">{money(p.costs.transporterHire)}</td></tr>
                <tr><td className="muted">− Loading</td><td className="num">{money(p.costs.loadingCharges)}</td></tr>
                <tr><td className="muted">− Unloading</td><td className="num">{money(p.costs.unloadingCharges)}</td></tr>
                <tr><td className="muted">− Diesel</td><td className="num">{money(p.costs.diesel)}</td></tr>
                <tr><td className="muted">− Toll</td><td className="num">{money(p.costs.toll)}</td></tr>
                <tr><td className="muted">− RTO</td><td className="num">{money(p.costs.rto)}</td></tr>
                <tr><td className="muted">− Driver bata</td><td className="num">{money(p.costs.driverBata)}</td></tr>
                <tr><td className="muted">− Other trip expense</td><td className="num">{money(p.costs.otherExpense)}</td></tr>
                <tr><td className="muted">− Expense entries linked to trips</td><td className="num">{money(p.linkedExpenses)}</td></tr>
                <tr><td><b>Trip profit</b></td><td className="num"><b><Money v={p.tripProfit} color /></b></td></tr>
                <tr><td className="muted">− Other expenses (office, salary, repair…)</td><td className="num">{money(p.otherExpenses)}</td></tr>
                <tr><td><b>{p.netProfit < 0 ? "NET LOSS" : "NET PROFIT"}</b></td><td className="num"><b><Money v={p.netProfit} color /></b></td></tr>
              </tbody></table>
              <p className="formula">{p.formula}</p>
            </div>
            <div className="card">
              <h2>Expenses by category</h2>
              <table><tbody>{p.expenseByCategory.map((c: any) => <tr key={c.category}><td>{c.category}</td><td className="num">{money(c.amount)}</td></tr>)}</tbody></table>
              {p.expenseByCategory.length === 0 && <div className="muted">No expense entries</div>}
            </div>
          </div>
          <div className="grid g2" style={{ marginTop: 16 }}>
            {[{ t: "Route profitability", d: routes.data }, { t: "Customer profitability", d: customers.data }].map(({ t, d }) => (
              <div className="card" key={t}>
                <h2>{t}</h2>
                {!d ? <Loading /> : (
                  <div className="table-wrap"><table>
                    <thead><tr><th>{d.columns[0].header}</th><th className="num">Trips</th><th className="num">Revenue</th><th className="num">Profit</th><th className="num">%</th></tr></thead>
                    <tbody>{d.rows.slice(0, 15).map((r: any) => <tr key={r.name}><td>{r.name}</td><td className="num">{r.trips}</td><td className="num">{money(r.revenue)}</td><td className="num"><Money v={r.profit} color /></td><td className="num">{r.profitPct}%</td></tr>)}</tbody>
                  </table></div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- targets
export function TargetsPage() {
  const { can } = useAuth();
  const { data, error, reload } = useLoad(() => api.get("/targets"), []);
  const [f, setF] = useState({ period: "MONTHLY", metric: "PROFIT", amount: "", date: todayIst() });
  const { busy, run } = useAction();
  if (!data) return <Loading error={error} />;
  return (
    <>
      <PageHead title="Targets" sub="Daily, weekly, monthly and financial-year targets" />
      <div className="grid g2">
        {data.map((t: any) => (
          <div className="card" key={t.period}>
            <div className="spread"><h2>{t.period} TARGET</h2><span className="muted small">{displayDate(t.range.start)} – {displayDate(t.range.end)}</span></div>
            <TargetGauge meter={t.meter} title={t.target ? `${t.target.metric} target` : ""} />
            <MeterDetails meter={t.meter} />
          </div>
        ))}
      </div>
      {can("targets.edit") && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Set a target</h2>
          <div className="form-grid">
            <Field label="Period"><select value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}>{["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].map((p) => <option key={p}>{p}</option>)}</select></Field>
            <Field label="Measure"><select value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value })}><option value="PROFIT">Net profit (₹)</option><option value="REVENUE">Revenue (₹)</option><option value="TRIPS">Number of trips</option></select></Field>
            <Field label="Target"><input type="number" min="1" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
            <Field label="For the period containing"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          </div>
          <div style={{ marginTop: 12 }}><button className="btn-primary" disabled={busy || !f.amount} onClick={() => run(() => api.post("/targets", f), "Target saved").then((r) => r && reload())}>Save target</button></div>
          <p className="muted small">Status rules: TARGET ACHIEVED when achieved ≥ target; ON TRACK when projected ≥ target; AT RISK when projected ≥ 85% of target; otherwise BEHIND TARGET. Projected = current daily average × days in the period. Weeks run Monday–Sunday; years are financial years (1 April – 31 March).</p>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- reports
export function ReportsPage() {
  const [sp, setSp] = useSearchParams();
  const list = useLoad(() => api.get("/reports"), []);
  const key = sp.get("r");
  const def = list.data?.find((r: any) => r.key === key);
  const q = Object.fromEntries([...sp.entries()].filter(([k]) => k !== "r"));
  const report = useLoad(() => (key ? api.get(`/reports/${key}`, q) : Promise.resolve(null)), [sp.toString()]);
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n); };
  const exportAs = (fmt: string) => download(`/reports/${key}?${new URLSearchParams({ ...q, format: fmt }).toString()}`);
  const fmt = (c: any, v: any) => (v === null || v === undefined ? "" : c.kind === "money" ? money(v, 2) : c.kind === "date" ? displayDate(v) : c.kind === "pct" ? `${v}%` : typeof v === "number" ? v.toLocaleString("en-IN") : v);
  if (!list.data) return <Loading error={list.error} />;
  return (
    <>
      <PageHead title="Reports" sub="View on screen, export to Excel, PDF or CSV" />
      <div className="grid" style={{ gridTemplateColumns: "minmax(200px, 260px) 1fr" }}>
        <div className="card hide-mobile" style={{ alignSelf: "start", padding: 8 }}>
          {list.data.map((r: any) => <a key={r.key} href="#" onClick={(e) => { e.preventDefault(); setSp({ r: r.key }); }} style={{ display: "block", padding: "7px 10px", borderRadius: 6, background: r.key === key ? "var(--blue-bg)" : undefined, color: "var(--text)" }}>{r.title}</a>)}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="only-mobile" style={{ marginBottom: 10 }}><select value={key ?? ""} onChange={(e) => setSp({ r: e.target.value })} style={{ width: "100%" }}><option value="">Choose a report…</option>{list.data.map((r: any) => <option key={r.key} value={r.key}>{r.title}</option>)}</select></div>
          {!def ? <div className="card muted">Choose a report.</div> : (
            <div className="card">
              <div className="spread"><h2>{report.data?.title ?? def.title}</h2>
                <div className="row"><button onClick={() => exportAs("xlsx")}>Excel</button><button onClick={() => exportAs("pdf")}>PDF</button><button onClick={() => exportAs("csv")}>CSV</button></div></div>
              <div className="filters">
                {def.filters.includes("date") && <><input type="date" value={q.from ?? ""} onChange={(e) => set("from", e.target.value)} aria-label="From" /><input type="date" value={q.to ?? ""} onChange={(e) => set("to", e.target.value)} aria-label="To" /></>}
                {def.filters.includes("customer") && <div style={{ minWidth: 180 }}><MasterSelect kind="customers" value={q.customerId} onChange={(v) => set("customerId", v)} placeholder="All customers" /></div>}
                {def.filters.includes("transporter") && <div style={{ minWidth: 180 }}><MasterSelect kind="transporters" value={q.transporterId} onChange={(v) => set("transporterId", v)} placeholder="All transporters" /></div>}
                {def.filters.includes("vehicle") && <div style={{ minWidth: 160 }}><MasterSelect kind="vehicles" value={q.vehicleId} onChange={(v) => set("vehicleId", v)} placeholder="All vehicles" /></div>}
                {def.filters.includes("driver") && <div style={{ minWidth: 160 }}><MasterSelect kind="drivers" value={q.driverId} onChange={(v) => set("driverId", v)} placeholder="All drivers" /></div>}
              </div>
              {!report.data ? <Loading error={report.error} /> : (
                <>
                  <div className="muted small" style={{ marginBottom: 8 }}>{report.data.subtitle} · {report.data.rows.length} row(s)</div>
                  <div className="table-wrap" style={{ maxHeight: "65vh" }}><table>
                    <thead><tr>{report.data.columns.map((c: any) => <th key={c.key} className={["money", "int", "num", "pct"].includes(c.kind) ? "num" : ""}>{c.header}</th>)}</tr></thead>
                    <tbody>
                      {report.data.rows.length === 0 && <tr><td colSpan={report.data.columns.length} className="empty">No data for this selection</td></tr>}
                      {report.data.rows.slice(0, 1000).map((r: any, i: number) => <tr key={i}>{report.data.columns.map((c: any) => <td key={c.key} className={["money", "int", "num", "pct"].includes(c.kind) ? "num" : ""}>{fmt(c, r[c.key])}</td>)}</tr>)}
                    </tbody>
                    {report.data.totals && <tfoot><tr>{report.data.columns.map((c: any) => <td key={c.key} className={["money", "int", "num", "pct"].includes(c.kind) ? "num" : ""}>{fmt(c, report.data.totals[c.key])}</td>)}</tr></tfoot>}
                  </table></div>
                  {report.data.rows.length > 1000 && <p className="muted small">Showing the first 1,000 rows. Export to Excel for all rows.</p>}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- documents
export function DocumentsPage() {
  const [page, setPage] = useState(1);
  const [docType, setDocType] = useState("");
  const { data, error, reload } = useLoad(() => api.get("/documents", { page, pageSize: 25, docType }), [page, docType]);
  return (
    <>
      <PageHead title="Documents" sub="LR, POD, invoices, e-way bills, receipts, vehicle and driver documents" />
      <div className="card" style={{ marginBottom: 12 }}><h3>Upload a general document</h3><DocUpload defaultType="OTHER" onDone={reload} /><p className="muted small">To link a document to a trip, vehicle, driver or expense, upload it from that record's page.</p></div>
      <div className="filters"><select value={docType} onChange={(e) => { setDocType(e.target.value); setPage(1); }} aria-label="Type"><option value="">All types</option>{DOC_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
      {!data ? <Loading error={error} /> : (
        <>
          <DocList docs={data.rows} />
          <Pager page={page} pageSize={25} total={data.total} onPage={setPage} />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- alerts
export function AlertsPage() {
  const [page, setPage] = useState(1);
  const n = useLoad(() => api.get("/alerts", { page, pageSize: 25 }), [page]);
  const exp = useLoad(() => api.get("/alerts/expiry"), []);
  const { run } = useAction();
  return (
    <>
      <PageHead title="Alerts">
        <button onClick={() => run(() => api.post("/alerts/refresh"), "Alerts refreshed").then(() => { n.reload(); exp.reload(); })}>Refresh</button>
        <button onClick={() => run(() => api.post("/alerts/all/read"), "All marked read").then(n.reload)}>Mark all read</button>
      </PageHead>
      <div className="grid g2">
        <div className="card">
          <h2>Expiry alerts (RC, insurance, FC, permit, pollution, road tax, licence)</h2>
          {!exp.data ? <Loading error={exp.error} /> : exp.data.length === 0 ? <div className="muted">Nothing expiring in the next 60 days.</div> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Vehicle / Driver</th><th>Document</th><th>Expiry</th><th className="num">Days</th><th>Alert</th></tr></thead>
              <tbody>{exp.data.map((e: any, i: number) => <tr key={i}><td><Link to={`/masters/${e.kind === "VEHICLE" ? "vehicles" : "drivers"}/${e.id}`}>{e.name}</Link></td><td>{e.document}</td><td>{displayDate(e.expiryDate)}</td><td className="num">{e.daysLeft}</td><td><Badge s={e.level} /></td></tr>)}</tbody>
            </table></div>
          )}
        </div>
        <div className="card">
          <h2>Notifications</h2>
          {!n.data ? <Loading error={n.error} /> : (
            <>
              {n.data.rows.length === 0 && <div className="muted">No notifications.</div>}
              {n.data.rows.map((a: any) => (
                <div key={a.id} className="spread" style={{ padding: "8px 0", borderBottom: "1px solid var(--line)", opacity: a.readAt ? 0.6 : 1 }}>
                  <div><Badge s={a.severity} /> <b>{a.title}</b><div className="muted small">{a.message} · {dateTime(a.createdAt)}</div></div>
                  {!a.readAt && <button className="btn-sm" onClick={() => run(() => api.post(`/alerts/${a.id}/read`)).then(n.reload)}>Read</button>}
                </div>
              ))}
              <Pager page={page} pageSize={25} total={n.data.total} onPage={setPage} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
