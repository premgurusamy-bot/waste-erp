import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { money } from "../format";

// ---------------------------------------------------------------- toast
type Toast = { kind: "ok" | "err"; text: string } | null;
const ToastCtx = createContext<(kind: "ok" | "err", text: string) => void>(() => {});
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [t, setT] = useState<Toast>(null);
  const timer = useRef<number>();
  const show = useCallback((kind: "ok" | "err", text: string) => {
    setT({ kind, text });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setT(null), kind === "err" ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && <div className={`toast ${t.kind}`} role="status" onClick={() => setT(null)}>{t.text}</div>}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------------------------------------------------------------- data loading
export function useLoad<T>(fn: () => Promise<T>, deps: any[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn().then((d) => { if (alive) { setData(d); setError(null); } }).catch((e) => { if (alive) setError(e.message); }).finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((x) => x + 1), setData };
}

/** Run an action with a busy flag and toast feedback. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    setBusy(true);
    try {
      const r = await fn();
      if (ok) toast("ok", ok);
      return r;
    } catch (e) {
      toast("err", e instanceof ApiError ? e.message : (e as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

// ---------------------------------------------------------------- small pieces
export function PageHead({ title, sub, children }: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <div className="muted small" style={{ marginTop: 2 }}>{sub}</div>}
      </div>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}

export function Loading({ error }: { error?: string | null }) {
  if (error) return <div className="alert red">{error}</div>;
  return <div className="empty">Loading…</div>;
}

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "green", INACTIVE: "", BOOKED: "blue", ALLOCATED: "blue", LOADED: "amber", "IN TRANSIT": "amber", DELIVERED: "green", "POD RECEIVED": "green",
  BILLED: "blue", SETTLED: "green", CLOSED: "", CANCELLED: "red", PAID: "green", UNPAID: "red", PARTIAL: "amber", PENDING: "amber", ISSUED: "blue",
  VERIFIED: "green", SUCCESS: "green", FAILED: "red", CORRUPTED: "red", RUNNING: "amber", BLOCKED: "red", EXPIRED: "red", "7 DAYS": "red", "15 DAYS": "amber",
  "30 DAYS": "amber", "60 DAYS": "blue", CRITICAL: "red", URGENT: "red", WARNING: "amber", INFO: "blue", OK: "green", "ON TRACK": "green", "AT RISK": "amber",
  "BEHIND TARGET": "red", "TARGET ACHIEVED": "green", AUTOMATIC: "blue", MANUAL: "", "PRE-RESTORE": "amber", "PRE-UPDATE": "amber", EMERGENCY: "red", EXPORT: "",
};
export function Badge({ s }: { s?: string | null }) {
  if (!s) return null;
  return <span className={`badge ${STATUS_COLOR[s] ?? ""}`}>{s}</span>;
}

export function Money({ v, d = 0, color }: { v: unknown; d?: number; color?: boolean }) {
  const n = Number(v ?? 0);
  return <span className={color ? (n < 0 ? "neg" : n > 0 ? "pos" : "") : ""}>{v === null || v === undefined ? "—" : money(n, d)}</span>;
}

export function Kpi({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "green" | "red" | "amber" | "blue" }) {
  return (
    <div className={`kpi ${tone ?? ""}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-label={title}>
        <div className="modal-head"><b>{title}</b><button className="btn-sm" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Confirmation that requires typing a word, for actions that replace or delete data. */
export function TypedConfirm({ title, message, word, onConfirm, onClose, busy, danger = true }: { title: string; message: React.ReactNode; word: string; onConfirm: () => void; onClose: () => void; busy?: boolean; danger?: boolean }) {
  const [v, setV] = useState("");
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button onClick={onClose}>Cancel</button>
      <button className={danger ? "btn-danger" : "btn-primary"} disabled={v.trim().toUpperCase() !== word || busy} onClick={onConfirm}>{busy ? "Working…" : "Confirm"}</button>
    </>}>
      <div className="stack">
        <div>{message}</div>
        <label className="field">Type <b>{word}</b> to confirm<input autoFocus value={v} onChange={(e) => setV(e.target.value)} /></label>
      </div>
    </Modal>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return <div className="tabs">{tabs.map((t) => <button key={t.key} className={value === t.key ? "active" : ""} onClick={() => onChange(t.key)}>{t.label}</button>)}</div>;
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pager">
      <span className="muted">{total.toLocaleString("en-IN")} record(s)</span>
      <button className="btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Prev</button>
      <span>Page {page} of {pages}</span>
      <button className="btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next ›</button>
    </div>
  );
}

// ---------------------------------------------------------------- form fields
export function Field({ label, error, children, wide }: { label: string; error?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className="field" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      {label}
      {children}
      {error && <span className="err">{error}</span>}
    </label>
  );
}

type Opt = { id: string; label: string; code?: string; extra?: any };
const optionCache = new Map<string, Promise<Opt[]>>();
export function clearOptionCache() { optionCache.clear(); }
export function useOptions(kind: string) {
  const [opts, setOpts] = useState<Opt[]>([]);
  useEffect(() => {
    if (!optionCache.has(kind)) optionCache.set(kind, api.get<Opt[]>(`/masters/${kind}/options`).catch(() => { optionCache.delete(kind); return []; }));
    optionCache.get(kind)!.then(setOpts);
  }, [kind]);
  return opts;
}

export function MasterSelect({ kind, value, onChange, placeholder = "— select —", required }: { kind: string; value: string | null | undefined; onChange: (id: string, opt?: Opt) => void; placeholder?: string; required?: boolean }) {
  const opts = useOptions(kind);
  return (
    <select value={value ?? ""} required={required} onChange={(e) => onChange(e.target.value, opts.find((o) => o.id === e.target.value))}>
      <option value="">{placeholder}</option>
      {opts.map((o) => <option key={o.id} value={o.id}>{o.label}{o.code && kind !== "vehicles" ? ` (${o.code})` : ""}</option>)}
    </select>
  );
}

/** Target meter: semicircle gauge + the full calculation underneath. */
export function TargetGauge({ meter, title }: { meter: any; title: string }) {
  if (!meter) return <div className="meter"><h3>{title}</h3><div className="muted">No target set</div></div>;
  const pct = Math.max(0, Math.min(100, meter.achievementPct));
  const ang = Math.PI * (1 - pct / 100);
  const x = 100 + 80 * Math.cos(ang), y = 100 - 80 * Math.sin(ang);
  const color = meter.status === "TARGET ACHIEVED" || meter.status === "ON TRACK" ? "#1e8e4e" : meter.status === "AT RISK" ? "#b9770e" : "#c0392b";
  return (
    <div className="meter">
      <h3>{title}</h3>
      <svg viewBox="0 0 200 115" width="100%" style={{ maxWidth: 260 }}>
        <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="#e6ebf2" strokeWidth="16" strokeLinecap="round" />
        {pct > 0 && <path d={`M20 100 A80 80 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`} fill="none" stroke={color} strokeWidth="16" strokeLinecap="round" />}
        <text x="100" y="88" textAnchor="middle" fontSize="26" fontWeight="700" fill="#1c2430">{meter.achievementPct.toFixed(0)}%</text>
        <text x="100" y="108" textAnchor="middle" fontSize="10" fill="#6b7686">{money(meter.achieved)} of {money(meter.target)}</text>
      </svg>
      <div className="status" style={{ color }}>{meter.status}</div>
    </div>
  );
}

export function MeterDetails({ meter }: { meter: any }) {
  if (!meter) return null;
  const rows: [string, React.ReactNode, string?][] = [
    ["Target", money(meter.target)], ["Achieved", money(meter.achieved)], ["Remaining", money(meter.remaining), meter.formulas.remaining],
    ["Achievement", `${meter.achievementPct}%`, meter.formulas.achievementPct], ["Days remaining", meter.daysRemaining],
    ["Required daily", money(meter.requiredDaily), meter.formulas.requiredDaily], ["Current daily average", money(meter.currentDailyAverage), meter.formulas.currentDailyAverage],
    ["Projected", money(meter.projected), meter.formulas.projected],
  ];
  return (
    <table className="meter-table">
      <tbody>{rows.map(([k, v, f]) => <tr key={k}><td className="muted">{k}</td><td className="num"><b>{v}</b></td><td className="formula hide-mobile">{f}</td></tr>)}</tbody>
    </table>
  );
}
