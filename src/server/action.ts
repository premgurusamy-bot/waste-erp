import "server-only";
import { revalidatePath } from "next/cache";
import { serialize } from "@/lib/utils";
import { getCtx } from "./auth/current-user";
import type { Ctx } from "./context";
import { toActionError, type ActionResult } from "./errors";
import { assertLicenseWritable } from "./license";

/**
 * Wrap a service call for a server action: auth context, licence check, friendly errors, cache revalidation.
 * `allowUnlicensed` is for the few actions that must work in view-only mode (own password, licence install).
 */
export async function act<T>(fn: (ctx: Ctx) => Promise<T>, revalidate: string[] = [], opts: { allowUnlicensed?: boolean } = {}): Promise<ActionResult<any>> {
  try {
    const ctx = await getCtx();
    if (!opts.allowUnlicensed) await assertLicenseWritable();
    const data = await fn(ctx);
    for (const p of revalidate) revalidatePath(p, p.endsWith("]") ? "page" : undefined);
    return { ok: true, data: data === undefined ? undefined : serialize(data) };
  } catch (err) {
    return toActionError(err);
  }
}
