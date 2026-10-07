import type { PartyType } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { round2 } from "@/lib/utils";
import type { Ctx } from "./context";
import { AppError } from "./errors";
import { nextNumber } from "./numbering";

/** System ledger account codes (seeded). */
export const ACC = {
  CASH: "1000",
  BANK: "1010",
  AR_CUSTOMERS: "1100",
  AR_BUYERS: "1110",
  GST_IN_CGST: "1300",
  GST_IN_SGST: "1301",
  GST_IN_IGST: "1302",
  AP_SUPPLIERS: "2000",
  GST_OUT_CGST: "2100",
  GST_OUT_SGST: "2101",
  GST_OUT_IGST: "2102",
  CAPITAL: "3000",
  SERVICE_INCOME: "4000",
  RECYCLABLE_SALES: "4100",
  ROUND_OFF: "4900",
  PURCHASES: "5000",
  OTHER_EXPENSES: "5190",
} as const;

export type JLine = {
  accountCode?: string;
  accountId?: string;
  debit?: number;
  credit?: number;
  partyType?: PartyType;
  partyId?: string;
  description?: string;
};

/** Post a balanced double-entry journal. Zero lines are dropped. */
export async function postJournal(
  tx: Tx,
  ctx: Ctx,
  entry: { date: Date; narration: string; sourceType: string; sourceId: string; sourceNumber: string; lines: JLine[]; isReversal?: boolean },
) {
  const lines = entry.lines
    .map((l) => ({ ...l, debit: round2(l.debit ?? 0), credit: round2(l.credit ?? 0) }))
    .filter((l) => l.debit !== 0 || l.credit !== 0)
    .map((l) => {
      // A negative amount on one side is posted on the other side.
      if (l.debit < 0) return { ...l, credit: -l.debit, debit: 0 };
      if (l.credit < 0) return { ...l, debit: -l.credit, credit: 0 };
      return l;
    });
  const dr = round2(lines.reduce((s, l) => s + l.debit, 0));
  const cr = round2(lines.reduce((s, l) => s + l.credit, 0));
  if (dr !== cr) throw new AppError(`Accounting entry is not balanced (debit ${dr} vs credit ${cr}).`);
  if (lines.length === 0) return null;

  const codes = [...new Set(lines.filter((l) => l.accountCode).map((l) => l.accountCode!))];
  const accounts = await tx.ledgerAccount.findMany({ where: { code: { in: codes } } });
  const byCode = new Map(accounts.map((a) => [a.code, a.id]));
  const number = await nextNumber(tx, "JOURNAL", entry.date);
  return tx.journalEntry.create({
    data: {
      number,
      date: entry.date,
      narration: entry.narration,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      sourceNumber: entry.sourceNumber,
      isReversal: entry.isReversal ?? false,
      createdById: ctx.userId,
      lines: {
        create: lines.map((l) => {
          const accountId = l.accountId ?? byCode.get(l.accountCode!);
          if (!accountId) throw new AppError(`Ledger account ${l.accountCode} is not configured.`);
          return {
            accountId,
            debit: l.debit,
            credit: l.credit,
            partyType: l.partyType ?? null,
            partyId: l.partyId ?? null,
            description: l.description ?? null,
          };
        }),
      },
    },
  });
}

/** Post the mirror image of every journal for a source document (cancellation). */
export async function reverseJournal(tx: Tx, ctx: Ctx, sourceType: string, sourceId: string, date: Date, reason: string) {
  const entries = await tx.journalEntry.findMany({
    where: { sourceType, sourceId, isReversal: false },
    include: { lines: true },
  });
  for (const e of entries) {
    await postJournal(tx, ctx, {
      date,
      narration: `Reversal of ${e.number}: ${reason}`,
      sourceType,
      sourceId,
      sourceNumber: e.sourceNumber ?? "",
      isReversal: true,
      lines: e.lines.map((l) => ({
        accountId: l.accountId,
        debit: Number(l.credit),
        credit: Number(l.debit),
        partyType: l.partyType ?? undefined,
        partyId: l.partyId ?? undefined,
        description: l.description ?? undefined,
      })),
    });
  }
}
