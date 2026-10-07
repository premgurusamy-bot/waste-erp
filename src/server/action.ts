import "server-only";
import { revalidatePath } from "next/cache";
import { serialize } from "@/lib/utils";
import { getCtx } from "./auth/current-user";
import type { Ctx } from "./context";
import { toActionError, type ActionResult } from "./errors";

/** Wrap a service call for a server action: auth context, friendly errors, cache revalidation. */
export async function act<T>(fn: (ctx: Ctx) => Promise<T>, revalidate: string[] = []): Promise<ActionResult<any>> {
  try {
    const ctx = await getCtx();
    const data = await fn(ctx);
    for (const p of revalidate) revalidatePath(p, p.endsWith("]") ? "page" : undefined);
    return { ok: true, data: data === undefined ? undefined : serialize(data) };
  } catch (err) {
    return toActionError(err);
  }
}
