import { useEffect, useState } from "react";
import { api } from "../api";

export function LoginPage() {
  const [username, setU] = useState("");
  const [password, setP] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get("/setup/status").then((s) => { if (s.needsSetup) location.href = "/setup"; }).catch(() => {});
  }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api.post("/auth/login", { username, password });
      const next = new URLSearchParams(location.search).get("next");
      location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-wrap">
      <form className="login-card stack" onSubmit={submit}>
        <div>
          <h1>G ROAD LINES</h1>
          <div className="muted">Transport Agent ERP · Sign in</div>
        </div>
        {err && <div className="alert red">{err}</div>}
        <label className="field">Username<input autoFocus autoComplete="username" value={username} onChange={(e) => setU(e.target.value)} required /></label>
        <label className="field">Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setP(e.target.value)} required /></label>
        <button className="btn-primary btn-lg" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <div className="muted small">Your data stays on your own server. Backups are kept in Documents/G Road Lines ERP/Backup.</div>
      </form>
    </div>
  );
}

export function SetupPage() {
  const [f, setF] = useState({ companyName: "G Road Lines", name: "", username: "admin", password: "", confirm: "" });
  const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.password !== f.confirm) return setErr("Passwords do not match.");
    try {
      await api.post("/setup", f);
      await api.post("/auth/login", { username: f.username, password: f.password });
      location.href = "/backup?firstRun=1";
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="login-wrap">
      <form className="login-card stack" onSubmit={submit} style={{ maxWidth: 440 }}>
        <div>
          <h1>Welcome to GRL ERP</h1>
          <div className="muted">First-time setup: create the administrator account.</div>
        </div>
        <div className="alert blue">Moving from another computer? After this step, go to <b>Backup &amp; Restore → RESTORE FROM EXCEL</b> and choose your latest backup file.</div>
        {err && <div className="alert red">{err}</div>}
        <label className="field">Company name<input value={f.companyName} onChange={set("companyName")} required /></label>
        <label className="field">Your name<input value={f.name} onChange={set("name")} required /></label>
        <label className="field">Username<input value={f.username} onChange={set("username")} required /></label>
        <label className="field">Password (8+ characters, letters and numbers)<input type="password" value={f.password} onChange={set("password")} required /></label>
        <label className="field">Confirm password<input type="password" value={f.confirm} onChange={set("confirm")} required /></label>
        <button className="btn-primary btn-lg">Create administrator</button>
      </form>
    </div>
  );
}
