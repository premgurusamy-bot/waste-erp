import type { PartyType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { addDays, dateOnly, num, round2 } from "@/lib/utils";

const DEBIT_NATURE = new Set(["ASSET", "EXPENSE"]);

/** Trial balance as on a date. Balances are shown on their natural side. */
export async function trialBalance(asOfISO: string) {
  const asOf = addDays(dateOnly(asOfISO), 1);
  const [accounts, sums] = await Promise.all([
    prisma.ledgerAccount.findMany({ orderBy: { code: "asc" } }),
    prisma.journalLine.groupBy({ by: ["accountId"], where: { entry: { date: { lt: asOf } } }, _sum: { debit: true, credit: true } }),
  ]);
  const rows = accounts.map((a) => {
    const s = sums.find((x) => x.accountId === a.id);
    const opening = num(a.openingBalance);
    const dr = num(s?._sum.debit);
    const cr = num(s?._sum.credit);
    const net = round2((DEBIT_NATURE.has(a.type) ? opening : -opening) + dr - cr); // + = debit balance
    return { id: a.id, code: a.code, name: a.name, type: a.type, subType: a.subType, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0, turnoverDr: dr, turnoverCr: cr };
  });
  return rows.filter((r) => r.debit || r.credit || r.turnoverDr || r.turnoverCr);
}

export async function accountLedger(accountId: string, fromISO: string, toISO: string, party?: { type: PartyType; id: string }) {
  const from = dateOnly(fromISO);
  const to = addDays(dateOnly(toISO), 1);
  const acc = await prisma.ledgerAccount.findUnique({ where: { id: accountId } });
  if (!acc) return null;
  const partyWhere = party ? { partyType: party.type, partyId: party.id } : {};
  const before = await prisma.journalLine.aggregate({ where: { accountId, ...partyWhere, entry: { date: { lt: from } } }, _sum: { debit: true, credit: true } });
  const lines = await prisma.journalLine.findMany({
    where: { accountId, ...partyWhere, entry: { date: { gte: from, lt: to } } },
    include: { entry: true },
    orderBy: [{ entry: { date: "asc" } }, { entry: { createdAt: "asc" } }],
    take: 5000,
  });
  const sign = DEBIT_NATURE.has(acc.type) ? 1 : -1;
  const opening = round2((party ? 0 : sign * num(acc.openingBalance)) + num(before._sum.debit) - num(before._sum.credit));
  let bal = opening;
  const rows = lines.map((l) => {
    bal = round2(bal + num(l.debit) - num(l.credit));
    return { id: l.id, date: l.entry.date, number: l.entry.number, narration: l.entry.narration, sourceType: l.entry.sourceType, sourceId: l.entry.sourceId, sourceNumber: l.entry.sourceNumber, debit: num(l.debit), credit: num(l.credit), balance: bal };
  });
  return { account: acc, opening, rows, closing: bal, totalDr: round2(rows.reduce((s, r) => s + r.debit, 0)), totalCr: round2(rows.reduce((s, r) => s + r.credit, 0)) };
}

/** Party-wise balances from the receivable/payable control accounts. */
export async function partyBalances(kind: "receivables" | "payables") {
  const codes = kind === "receivables" ? ["1100", "1110"] : ["2000"];
  const grouped = await prisma.journalLine.groupBy({
    by: ["partyType", "partyId"],
    where: { account: { code: { in: codes } }, partyId: { not: null } },
    _sum: { debit: true, credit: true },
  });
  const ids = grouped.map((g) => g.partyId!) as string[];
  const [customers, buyers, suppliers] = await Promise.all([
    prisma.customer.findMany({ where: { id: { in: ids } } }),
    prisma.buyer.findMany({ where: { id: { in: ids } } }),
    prisma.supplier.findMany({ where: { id: { in: ids } } }),
  ]);
  const name = new Map([...customers, ...buyers, ...suppliers].map((p) => [p.id, p.name]));
  return grouped
    .map((g) => {
      const bal = round2(num(g._sum.debit) - num(g._sum.credit));
      return { partyType: g.partyType!, partyId: g.partyId!, name: name.get(g.partyId!) ?? "", debit: num(g._sum.debit), credit: num(g._sum.credit), balance: kind === "receivables" ? bal : -bal };
    })
    .filter((r) => Math.abs(r.balance) > 0.009)
    .sort((a, b) => b.balance - a.balance);
}
