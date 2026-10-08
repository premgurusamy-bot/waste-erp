import { z } from "zod";
import { badRequest } from "./errors.js";

export const optStr = (max = 200) =>
  z.preprocess((v) => (v === null || v === undefined ? null : String(v).trim() === "" ? null : String(v).trim()), z.string().max(max).nullable()).optional();
export const reqStr = (max = 200) => z.preprocess((v) => (v === null || v === undefined ? "" : String(v).trim()), z.string().min(1, "is required").max(max));
export const money = z.preprocess((v) => (v === "" || v === null || v === undefined ? 0 : Number(v)), z.number().finite().min(0, "cannot be negative").max(1e11));
export const signedMoney = z.preprocess((v) => (v === "" || v === null || v === undefined ? 0 : Number(v)), z.number().finite().min(-1e11).max(1e11));
export const optNum = z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().finite().min(0).max(1e9).nullable()).optional();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date (YYYY-MM-DD)").refine((s) => !isNaN(Date.parse(s)), "is not a valid date");
export const optDate = z.preprocess((v) => (v === "" || v === undefined ? null : v), isoDate.nullable()).optional();
export const optId = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().uuid().nullable()).optional();
export const reqId = z.string().uuid("must be selected");
export const gstin = z.preprocess(
  (v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim().toUpperCase()),
  z.string().regex(/^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$/, "must be a 15-character GSTIN").nullable(),
).optional();
export const pan = z.preprocess(
  (v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim().toUpperCase()),
  z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "must be a 10-character PAN").nullable(),
).optional();
export const mobile = z.preprocess(
  (v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).replace(/[\s-]/g, "")),
  z.string().regex(/^\+?[0-9]{10,13}$/, "must be a valid mobile number").nullable(),
).optional();
export const email = z.preprocess((v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim()), z.string().email().nullable()).optional();

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const i of r.error.issues) fields[i.path.join(".") || "_"] = i.message;
    const first = r.error.issues[0];
    throw badRequest(`${first.path.join(".") || "Input"} ${first.message}`.trim(), { fields });
  }
  return r.data;
}

/** Turn YYYY-MM-DD strings in a validated object into Date objects for Prisma @db.Date columns. */
export function dates<T extends Record<string, any>>(o: T, keys: readonly string[]): T {
  const out: any = { ...o };
  for (const k of keys) if (k in out) out[k] = out[k] ? new Date(`${out[k]}T00:00:00.000Z`) : null;
  return out;
}
