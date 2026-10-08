import React, { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api";

export type Me = {
  user: { id: string; username: string; name: string; role: string };
  permissions: string[];
  company: any;
  license: { plan: string; level: string; writable: boolean; message: string; expiryDate: string | null; daysLeft: number | null; machineId: string; company: string | null };
  version: string;
};

const Ctx = createContext<{ me: Me | null; reload: () => Promise<void>; can: (p: string) => boolean }>({ me: null, reload: async () => {}, can: () => false });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const reload = async () => {
    try { setMe(await api.get<Me>("/auth/me")); } catch { setMe(null); } finally { setReady(true); }
  };
  useEffect(() => { reload(); }, []);
  if (!ready) return <div className="empty">Loading…</div>;
  return <Ctx.Provider value={{ me, reload, can: (p) => !!me?.permissions.includes(p) }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
