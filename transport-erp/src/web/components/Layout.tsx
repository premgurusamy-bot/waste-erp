import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { useLoad } from "./ui";

const NAV: { to: string; label: string; ico: string; perm?: string }[] = [
  { to: "/", label: "Dashboard", ico: "◧" },
  { to: "/trips", label: "Trips", ico: "⛟", perm: "trips.view" },
  { to: "/masters/customers", label: "Customers", ico: "☺", perm: "masters.view" },
  { to: "/masters/transporters", label: "Transporters", ico: "⚑", perm: "masters.view" },
  { to: "/masters/vehicles", label: "Vehicles", ico: "▣", perm: "masters.view" },
  { to: "/masters/drivers", label: "Drivers", ico: "☻", perm: "masters.view" },
  { to: "/billing", label: "Billing", ico: "₹", perm: "billing.view" },
  { to: "/payments", label: "Payments", ico: "⇄", perm: "billing.view" },
  { to: "/expenses", label: "Expenses", ico: "✎", perm: "expenses.view" },
  { to: "/profit", label: "Profitability", ico: "↗", perm: "profit.view" },
  { to: "/targets", label: "Targets", ico: "◎", perm: "profit.view" },
  { to: "/reports", label: "Reports", ico: "▤", perm: "reports.view" },
  { to: "/documents", label: "Documents", ico: "❏", perm: "documents.view" },
  { to: "/backup", label: "Backup & Restore", ico: "⛁", perm: "backup.create" },
  { to: "/alerts", label: "Alerts", ico: "⚠" },
  { to: "/settings", label: "Settings", ico: "⚙" },
];

function Search() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<any[] | null>(null);
  const nav = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return; }
    const t = setTimeout(() => api.get<any[]>("/search", { q }).then(setRes).catch(() => setRes([])), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setRes(null); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  return (
    <div className="search" ref={box}>
      <input placeholder="Search trip, LR, invoice, vehicle, customer, mobile…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
      {res && (
        <div className="search-results">
          {res.length === 0 && <div className="empty">No match</div>}
          {res.map((r) => (
            <a key={r.type + r.id} href={r.link} onClick={(e) => { e.preventDefault(); setRes(null); setQ(""); nav(r.link); }}>
              <span className="type">{r.type}</span> <b>{r.title}</b>
              <div className="muted small">{r.subtitle}</div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function Banners() {
  const { me, can } = useAuth();
  const loc = useLocation();
  const health = useLoad(() => (can("backup.create") ? api.get("/backup/health") : Promise.resolve(null)), [loc.pathname === "/"]);
  const lic = me?.license;
  return (
    <>
      {lic && lic.level !== "OK" && (
        <div className={`alert ${lic.level === "WARNING" ? "amber" : "red"}`}>
          <b>{lic.level === "EXPIRED" ? "LICENSE EXPIRED" : lic.level === "INVALID" ? "LICENCE NOT VALID" : lic.plan === "TRIAL" ? "TRIAL LICENCE" : "LICENCE"}</b>
          <span>{lic.message}</span>
          {can("license.manage") && <NavLink to="/settings?tab=license">Renew licence</NavLink>}
        </div>
      )}
      {health.data?.reminder && (
        <div className={`alert ${health.data.reminderLevel === "WARNING" ? "amber" : "red"}`}>
          <b>{health.data.reminderLevel === "CRITICAL" ? "CRITICAL" : health.data.reminderLevel === "URGENT" ? "URGENT" : "BACKUP"}:</b> {health.data.reminder}
          <NavLink to="/backup">Backup now</NavLink>
        </div>
      )}
    </>
  );
}

export function Layout() {
  const { me, can } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const logout = async () => { await api.post("/auth/logout"); location.href = "/login"; };
  const items = NAV.filter((n) => !n.perm || can(n.perm));
  const title = items.find((n) => n.to !== "/" && loc.pathname.startsWith(n.to))?.label ?? "Dashboard";
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><b>G ROAD LINES</b><span>Transport Agent ERP</span></div>
        <nav className="nav">
          {items.map((n) => <NavLink key={n.to} to={n.to} end={n.to === "/"}><span className="ico">{n.ico}</span>{n.label}</NavLink>)}
        </nav>
        <div className="side-foot">GRL ERP · Version {me?.version}<br />Licence: {me?.license.plan} · {me?.license.level}</div>
      </aside>
      <div className="main">
        <header className="topbar">
          <span className="mobile-title">{title}</span>
          <Search />
          <div className="user-chip">
            <span className="uname">{me?.user.name} <span className="muted small">({me?.user.role.replace("_", " ")})</span></span>
            <button className="btn-sm hide-mobile" onClick={() => nav("/settings?tab=password")}>Account</button>
            <button className="btn-sm" onClick={logout}>Sign out</button>
          </div>
        </header>
        <main className="content">
          <Banners />
          <Outlet />
        </main>
      </div>
      <nav className="mobile-nav">
        <NavLink to="/" end><span className="ico">◧</span>Dashboard</NavLink>
        <NavLink to="/trips"><span className="ico">⛟</span>Trips</NavLink>
        <NavLink to="/more"><span className="ico">☰</span>More</NavLink>
      </nav>
    </div>
  );
}

export function MorePage() {
  const { can } = useAuth();
  return (
    <div className="stack">
      {NAV.filter((n) => (!n.perm || can(n.perm)) && n.to !== "/" && n.to !== "/trips").map((n) => (
        <NavLink key={n.to} to={n.to} className="card" style={{ display: "flex", gap: 12, alignItems: "center", color: "var(--text)" }}>
          <span style={{ fontSize: 20, width: 24, textAlign: "center" }}>{n.ico}</span><b>{n.label}</b>
        </NavLink>
      ))}
    </div>
  );
}
