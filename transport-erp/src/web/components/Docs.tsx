import { useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { bytes, dateTime } from "../format";
import { useAction } from "./ui";

export const DOC_TYPES = ["LR", "POD", "INVOICE", "EWAY_BILL", "RECEIPT", "EXPENSE_RECEIPT", "VEHICLE_DOC", "DRIVER_DOC", "OTHER"];

/** Upload with phone camera ("Take photo") or from files. */
export function DocUpload({ entityType, entityId, defaultType = "POD", types = DOC_TYPES, onDone, extra }: { entityType?: string; entityId?: string; defaultType?: string; types?: string[]; onDone: () => void; extra?: Record<string, string> }) {
  const { can } = useAuth();
  const [docType, setDocType] = useState(defaultType);
  const cam = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction();
  if (!can("documents.upload")) return null;
  const send = async (f?: File) => {
    if (!f) return;
    const r = await run(() => api.upload("/documents", f, { docType, entityType: entityType ?? "", entityId: entityId ?? "", ...(extra ?? {}) }), `${docType} uploaded`);
    if (r) onDone();
    if (cam.current) cam.current.value = "";
    if (file.current) file.current.value = "";
  };
  return (
    <div className="row">
      <select value={docType} onChange={(e) => setDocType(e.target.value)} aria-label="Document type">{types.map((t) => <option key={t}>{t}</option>)}</select>
      <button disabled={busy} onClick={() => cam.current?.click()}>📷 Take photo</button>
      <button disabled={busy} onClick={() => file.current?.click()}>📎 Choose file</button>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => send(e.target.files?.[0])} />
      <input ref={file} type="file" accept="image/*,application/pdf" hidden onChange={(e) => send(e.target.files?.[0])} />
      {busy && <span className="muted">Uploading…</span>}
    </div>
  );
}

export function DocList({ docs }: { docs: any[] }) {
  if (!docs?.length) return <div className="muted small">No documents yet.</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Type</th><th>File</th><th className="hide-mobile">Size</th><th className="hide-mobile">Uploaded</th></tr></thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id}>
              <td>{d.docType}</td>
              <td><a href={`/api/documents/${d.id}/file`} target="_blank" rel="noopener noreferrer">{d.fileName}</a></td>
              <td className="hide-mobile">{bytes(d.sizeBytes)}</td>
              <td className="hide-mobile">{dateTime(d.createdAt)} · {d.uploadedBy}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
