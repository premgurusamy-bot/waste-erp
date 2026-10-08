export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: any) {
    super(message);
  }
}

async function handle(res: Response) {
  const ct = res.headers.get("content-type") ?? "";
  const body = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && !location.pathname.startsWith("/login") && !location.pathname.startsWith("/setup")) {
      location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    }
    throw new ApiError(res.status, (body && body.error) || `Request failed (${res.status})`, body?.details);
  }
  return body;
}

const headers = { "Content-Type": "application/json", "X-Requested-With": "GRL" };

export const api = {
  get: <T = any>(url: string, params?: Record<string, any>): Promise<T> => {
    const q = params ? Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&") : "";
    return fetch(`/api${url}${q ? `${url.includes("?") ? "&" : "?"}${q}` : ""}`, { credentials: "same-origin" }).then(handle);
  },
  post: <T = any>(url: string, body?: any): Promise<T> => fetch(`/api${url}`, { method: "POST", headers, credentials: "same-origin", body: JSON.stringify(body ?? {}) }).then(handle),
  put: <T = any>(url: string, body?: any): Promise<T> => fetch(`/api${url}`, { method: "PUT", headers, credentials: "same-origin", body: JSON.stringify(body ?? {}) }).then(handle),
  upload: <T = any>(url: string, file: File, fields: Record<string, string> = {}): Promise<T> => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v) fd.append(k, v);
    fd.append("file", file);
    return fetch(`/api${url}`, { method: "POST", headers: { "X-Requested-With": "GRL" }, credentials: "same-origin", body: fd }).then(handle);
  },
};

/** Download a file from the API (reports, backups) using the session cookie. */
export function download(url: string) {
  const a = document.createElement("a");
  a.href = `/api${url}`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
