import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { money, displayDate, dateTime } from "../format";
import { Badge, Kpi, Loading, Money, PageHead, TargetGauge, MeterDetails, useLoad } from "../components/ui";

function Bars({ series }: { series: { date: string; revenue: number; profit: number }[] }) {
  const max = Math.max(1, ...series.map((s) => s.revenue));
  return (
    <div>
      <div className="bars" aria-label="Revenue and profit, last 30 days">
        {series.map((s) => (
          <div className="bar" key={s.date} title={`${displayDate(s.date)}  Revenue ${money(s.revenue)}  Profit ${money(s.profit)}`}>
            <div className="rev" style={{ height: `${((s.revenue - Math.max(0, s.profit)) / max) * 120}px` }} />
            <div className={s.profit >= 0 ? "prof" : "loss"} style={{ height: `${(Math.abs(s.profit) / max) * 120}px` }} />
          </div>
        ))}
      </div>
      <div className="spread small muted" style={{ marginTop: 4 }}>
        <span>{displayDate(series[0]?.date)}</span>
        <span><span className="dot" style={{ background: "#9db8dc" }} />Revenue <span className="dot GREEN" style={{ marginLeft: 8 }} />Trip profit</span>
        <span>{displayDate(series.at(-1)?.date)}</span>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { can } = useAuth();
  const { data: d, error } = useLoad(() => api.get("/dashboard"), []);
  if (!d) return <Loading error={error} />;
  const m = d.monthTarget?.meter;
  const showMoney = can("profit.view");
  return (
    <>
      <PageHead title="Dashboard" sub={`Today ${displayDate(d.today)}`}>
        {can("trips.edit") && <Link className="btn btn-primary" to="/trips/new">+ New Trip</Link>}
      </PageHead>

      <div className="quick only-mobile" style={{ marginBottom: 12 }}>
        <Link to="/trips/new"><span className="q">⛟</span>NEW TRIP</Link>
        <Link to="/expenses/new"><span className="q">✎</span>EXPENSE</Link>
        <Link to="/trips?status=DELIVERED"><span className="q">📷</span>POD</Link>
        <Link to="/payments?new=1"><span className="q">₹</span>PAYMENT</Link>
        <Link to="/masters/customers/new"><span className="q">☺</span>CUSTOMER</Link>
      </div>

      <div className="kpis">
        <Kpi label="Today's Trips" value={d.todayTrips} tone="blue" />
        <Kpi label="Pending Loads" value={d.pendingLoads} sub="Booked / allocated" />
        <Kpi label="In Transit" value={d.inTransit} tone="amber" />
        <Kpi label="Pending POD" value={d.pendingPod} sub="Delivered, POD not received" tone={d.pendingPod ? "amber" : undefined} />
        {showMoney && <Kpi label="Today's Revenue" value={money(d.todayRevenue)} tone="blue" />}
        {showMoney && (d.todayNet < 0
          ? <Kpi label="Today's Loss" value={<span className="neg">{money(d.todayLoss)}</span>} tone="red" />
          : <Kpi label="Today's Profit" value={<span className="pos">{money(d.todayProfit)}</span>} tone="green" />)}
        {showMoney && <Kpi label="Monthly Revenue" value={money(d.monthRevenue)} />}
        {showMoney && <Kpi label="Monthly Profit" value={<Money v={d.monthProfit} color />} tone={d.monthProfit < 0 ? "red" : "green"} />}
        {m && <Kpi label="Monthly Target" value={money(m.target)} sub={`${m.achievementPct}% achieved`} />}
        {m && <Kpi label="Remaining Target" value={money(m.remaining)} sub={`${m.daysRemaining} days left`} />}
        {m && <Kpi label="Projected Profit" value={money(m.projected)} sub={m.status} tone={m.status === "BEHIND TARGET" ? "red" : m.status === "AT RISK" ? "amber" : "green"} />}
        {d.receivable !== null && <Kpi label="Receivable" value={money(d.receivable)} sub={<Link to="/payments?tab=receivables">Ageing</Link>} />}
        {d.payable !== null && <Kpi label="Payable" value={money(d.payable)} sub={<Link to="/payments?tab=payables">Details</Link>} />}
        <Kpi label="Active Trips" value={d.activeTrips} />
        <Kpi label="Pending Settlement" value={d.pendingSettlement} sub="Transporter settlements open" />
      </div>

      <div className="grid g3" style={{ marginTop: 16 }}>
        {showMoney && (
          <div className="card">
            <h2>PROFIT TARGET METER</h2>
            <TargetGauge meter={m} title={`Monthly ${d.monthTarget?.target?.metric ?? "profit"} target`} />
            <MeterDetails meter={m} />
            {!m && can("targets.edit") && <Link to="/targets">Set a monthly target</Link>}
          </div>
        )}
        {showMoney && d.series.length > 0 && (
          <div className="card" style={{ gridColumn: "span 2" }}>
            <h2>Last 30 days</h2>
            <Bars series={d.series} />
          </div>
        )}
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="spread"><h2>Recent trips</h2><Link to="/trips">All trips</Link></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Trip</th><th>Date</th><th>Customer</th><th className="hide-mobile">Route</th><th>Status</th></tr></thead>
              <tbody>
                {d.recentTrips.map((t: any) => (
                  <tr key={t.id}>
                    <td><Link to={`/trips/${t.id}`}>{t.tripNumber}</Link><div className="muted small">{t.vehicle?.vehicleNumber}</div></td>
                    <td className="nowrap">{displayDate(t.tripDate)}</td>
                    <td>{t.customer.name}</td>
                    <td className="hide-mobile">{t.loadingPoint?.name} → {t.deliveryPoint?.name}</td>
                    <td><Badge s={t.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {d.backup && (
          <div className="card">
            <div className="spread"><h2>BACKUP STATUS</h2><Link to="/backup">Backup &amp; Restore</Link></div>
            <div className="health">
              <div>Last Backup<b>{d.backup.lastBackupAt ? dateTime(d.backup.lastBackupAt) : "Never"}</b></div>
              <div>Backup<b><span className={`dot ${d.backup.status}`} />{d.backup.statusText}</b></div>
              <div>Database Backup<b>{d.backup.databaseBackupAvailable ? "AVAILABLE" : "NOT AVAILABLE"}</b></div>
              <div>Excel Backup<b>{d.backup.excelBackupAvailable ? "AVAILABLE" : "NOT AVAILABLE"}</b></div>
              <div>Last Restore Test<b>{d.backup.lastRestoreTestAt ? displayDate(d.backup.lastRestoreTestAt.slice(0, 10)) : "Never"}</b></div>
              <div>Backup Files<b>{d.backup.backupFileCount}</b></div>
              <div>Data Safety<b className={d.backup.dataSafety === "PROTECTED" ? "pos" : "neg"}>{d.backup.dataSafety}</b></div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
