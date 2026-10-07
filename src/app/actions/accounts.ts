"use server";

import { act } from "@/server/action";
import { createManualJournal } from "@/server/services/purchases";
import { saveLedgerAccount } from "@/server/services/settings";

export async function journalAction(values: Record<string, unknown>) {
  return act((ctx) => createManualJournal(ctx, values), ["/accounts"]);
}
export async function ledgerAccountAction(id: string | null, values: Record<string, unknown>) {
  return act((ctx) => saveLedgerAccount(ctx, id, values), ["/accounts"]);
}
