import type { Tx } from "@/lib/db";
import type { Ctx } from "./context";

export type AuditAction =
  | "CREATE" | "UPDATE" | "CANCEL" | "REVERSE" | "ACTIVATE" | "DEACTIVATE" | "OVERRIDE"
  | "LOGIN" | "LOGIN_FAILED" | "LOGOUT" | "PASSWORD_CHANGE" | "PASSWORD_RESET" | "STATUS_CHANGE"
  | "ASSIGN" | "COMPLETE" | "UPLOAD" | "DELETE" | "EMAIL" | "ALLOCATE";

const SENSITIVE = new Set(["passwordHash", "password", "newPassword"]);

function clean(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  const json = JSON.parse(JSON.stringify(value));
  if (json && typeof json === "object" && !Array.isArray(json)) {
    for (const k of Object.keys(json)) if (SENSITIVE.has(k)) json[k] = "***";
  }
  return json;
}

/** Only keep fields that actually changed, so the audit trail is readable. */
export function diff(oldValues: Record<string, any>, newValues: Record<string, any>) {
  const o = clean(oldValues) as Record<string, any>;
  const n = clean(newValues) as Record<string, any>;
  const before: Record<string, any> = {};
  const after: Record<string, any> = {};
  for (const key of Object.keys(n)) {
    if (["updatedAt", "createdAt"].includes(key)) continue;
    if (JSON.stringify(o?.[key]) !== JSON.stringify(n[key])) {
      before[key] = o?.[key] ?? null;
      after[key] = n[key];
    }
  }
  return { before, after };
}

export async function audit(
  tx: Tx,
  ctx: Ctx | null,
  entry: {
    action: AuditAction;
    module: string;
    recordId?: string | null;
    recordLabel?: string | null;
    oldValues?: unknown;
    newValues?: unknown;
    username?: string;
  },
) {
  await tx.auditLog.create({
    data: {
      userId: ctx?.userId ?? null,
      username: ctx?.username ?? entry.username ?? null,
      action: entry.action,
      module: entry.module,
      recordId: entry.recordId ?? null,
      recordLabel: entry.recordLabel ?? null,
      oldValues: (clean(entry.oldValues) ?? undefined) as any,
      newValues: (clean(entry.newValues) ?? undefined) as any,
      ipAddress: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
    },
  });
}
