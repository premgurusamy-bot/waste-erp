import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

/** An error whose message is safe and understandable to show to a business user. */
export class AppError extends Error {
  constructor(message: string, public fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "AppError";
  }
}

export class PermissionError extends AppError {
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "PermissionError";
  }
}

export type ActionResult<T = unknown> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Translate any thrown error into a user-friendly result. Never leaks stack traces. */
export function toActionError(err: unknown): { ok: false; error: string; fieldErrors?: Record<string, string> } {
  if (err instanceof AppError) return { ok: false, error: err.message, fieldErrors: err.fieldErrors };
  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      const target = (err.meta?.target as string[] | string | undefined) ?? "";
      const field = Array.isArray(target) ? target.join(", ") : String(target);
      return { ok: false, error: `A record with the same ${humanField(field)} already exists.` };
    }
    if (err.code === "P2003") return { ok: false, error: "This record is linked to other data and cannot be changed this way." };
    if (err.code === "P2025") return { ok: false, error: "The record was not found. It may have been changed by another user." };
  }
  if (err instanceof Prisma.PrismaClientUnknownRequestError || err instanceof Prisma.PrismaClientKnownRequestError) {
    const msg = String((err as Error).message);
    if (msg.includes("check constraint") || msg.includes("violates")) {
      return { ok: false, error: "The values entered break a data integrity rule. Please check quantities and amounts." };
    }
  }
  console.error("[unexpected error]", err);
  return { ok: false, error: "Something went wrong while saving. Please try again or contact the administrator." };
}

function humanField(f: string) {
  if (!f) return "value";
  if (f.includes("slipNumber")) return "weighbridge slip number";
  if (f.includes("vehicleId")) return "vehicle (an open weighment already exists for this vehicle)";
  return f.replace(/_/g, " ").replace(/([A-Z])/g, " $1").toLowerCase();
}
