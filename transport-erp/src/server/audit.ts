import { prisma, type Tx } from "./db.js";
import type { Ctx } from "./context.js";
import { plain } from "./lib/util.js";

const SECRET = /password|hash|secret|token|licenseKey/i;

function scrub(v: any): any {
  if (v === null || v === undefined) return undefined;
  const p = plain(v);
  if (typeof p !== "object" || Array.isArray(p)) return p;
  const out: any = {};
  for (const [k, val] of Object.entries(p)) out[k] = SECRET.test(k) ? "[hidden]" : val;
  return out;
}

/** Only keep the fields that changed, so the audit trail shows exactly what was edited. */
function diff(oldV: any, newV: any) {
  if (!oldV || !newV) return { oldValue: scrub(oldV), newValue: scrub(newV) };
  const o = scrub(oldV), n = scrub(newV);
  const oo: any = {}, nn: any = {};
  for (const k of new Set([...Object.keys(o), ...Object.keys(n)])) {
    if (k === "updatedAt") continue;
    if (JSON.stringify(o[k]) !== JSON.stringify(n[k])) { oo[k] = o[k]; nn[k] = n[k]; }
  }
  return { oldValue: oo, newValue: nn };
}

export async function audit(
  db: Tx | typeof prisma,
  ctx: Ctx | null,
  action: string,
  entity: { type?: string; id?: string; code?: string | null } = {},
  oldValue?: unknown,
  newValue?: unknown,
) {
  const d = diff(oldValue, newValue);
  await db.auditLog.create({
    data: {
      userId: ctx?.user.id === "system" ? null : ctx?.user.id,
      userName: ctx?.user.name ?? "SYSTEM",
      action,
      entityType: entity.type,
      entityId: entity.id,
      recordCode: entity.code ?? undefined,
      oldValue: d.oldValue ?? undefined,
      newValue: d.newValue ?? undefined,
      ip: ctx?.ip,
      device: ctx?.device?.slice(0, 250),
    },
  });
}
