"use client";

import { Loader2, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { allocateReceiptAction, openDocsAction, paymentAction, receiptAction, type OpenDoc } from "@/app/actions/receipts";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Select } from "@/components/ui/input";
import { cn, formatDate } from "@/lib/utils";
import type { Option } from "./entity-form";

const money = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const MODES = [["BANK_TRANSFER", "Bank transfer (NEFT/RTGS/IMPS)"], ["UPI", "UPI"], ["CHEQUE", "Cheque"], ["CASH", "Cash"], ["CARD", "Card"]];

/**
 * Receipt (customer / buyer) or supplier payment entry with allocation to open documents.
 * mode="allocate" allocates the unallocated balance of an existing receipt.
 */
export function MoneyForm({
  kind,
  customers = [],
  buyers = [],
  suppliers = [],
  accounts,
  defaults,
  allocateReceipt,
}: {
  kind: "receipt" | "payment" | "allocate";
  customers?: Option[];
  buyers?: Option[];
  suppliers?: Option[];
  accounts: Option[];
  defaults: { date: string; partyType?: "CUSTOMER" | "BUYER"; partyId?: string; accountId?: string };
  allocateReceipt?: { id: string; partyType: "CUSTOMER" | "BUYER"; partyId: string; available: number };
}) {
  const router = useRouter();
  const [partyType, setPartyType] = useState<"CUSTOMER" | "BUYER" | "SUPPLIER">(kind === "payment" ? "SUPPLIER" : allocateReceipt?.partyType ?? defaults.partyType ?? "CUSTOMER");
  const [partyId, setPartyId] = useState(allocateReceipt?.partyId ?? defaults.partyId ?? "");
  const [head, setHead] = useState({ date: defaults.date, amount: allocateReceipt ? String(allocateReceipt.available) : "", mode: "BANK_TRANSFER", accountId: defaults.accountId ?? "", reference: "", remarks: "" });
  const [docs, setDocs] = useState<OpenDoc[]>([]);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [loading, startLoad] = useTransition();
  const [saving, startSave] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setDocs([]);
    setAlloc({});
    if (!partyId) return;
    startLoad(async () => {
      const r = await openDocsAction(partyType, partyId);
      if (r.ok) setDocs(r.data as OpenDoc[]);
    });
  }, [partyType, partyId]);

  const amount = Number(head.amount) || 0;
  const allocated = r2(Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0));
  const autoAllocate = () => {
    let left = amount;
    const next: Record<string, string> = {};
    for (const d of docs) {
      if (left <= 0) break;
      const a = r2(Math.min(left, d.balance));
      next[d.id] = String(a);
      left = r2(left - a);
    }
    setAlloc(next);
  };
  const parties = partyType === "CUSTOMER" ? customers : partyType === "BUYER" ? buyers : suppliers;

  const submit = () => {
    const errs: Record<string, string> = {};
    if (!partyId) errs.party = "Select the party";
    if (!(amount > 0)) errs.amount = "Enter the amount";
    if (kind !== "allocate" && !head.accountId) errs.accountId = "Select the cash/bank account";
    if (allocated > amount) errs.alloc = `Allocated ${money(allocated)} is more than the amount ${money(amount)}`;
    for (const d of docs) if ((Number(alloc[d.id]) || 0) > d.balance) errs.alloc = `Allocation on ${d.number} exceeds its balance`;
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const allocations = docs.filter((d) => Number(alloc[d.id]) > 0).map((d) => ({ invoiceId: d.id, docId: d.id, docType: d.docType, amount: alloc[d.id] }));
    startSave(async () => {
      const r =
        kind === "payment"
          ? await paymentAction({ ...head, supplierId: partyId, allocations })
          : kind === "allocate"
            ? await allocateReceiptAction({ receiptId: allocateReceipt!.id, allocations })
            : await receiptAction({ ...head, partyType, customerId: partyType === "CUSTOMER" ? partyId : undefined, buyerId: partyType === "BUYER" ? partyId : undefined, allocations });
      if (!r.ok) {
        toast.error(r.error);
        setErrors({ alloc: r.error });
        return;
      }
      toast.success(kind === "payment" ? "Payment recorded" : kind === "allocate" ? "Allocated" : "Receipt recorded");
      router.push(kind === "payment" ? `/payments/${(r.data as any).id}` : `/receipts/${(r.data as any).id}`);
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {kind !== "allocate" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {kind === "receipt" && (
            <div>
              <Label>Received From</Label>
              <div className="flex rounded-lg border border-slate-300 p-0.5">
                {(["CUSTOMER", "BUYER"] as const).map((t) => (
                  <button key={t} type="button" onClick={() => { setPartyType(t); setPartyId(""); }} className={cn("h-8 flex-1 rounded-md text-sm font-medium", partyType === t ? "bg-navy-700 text-white" : "text-slate-600")}>
                    {t === "CUSTOMER" ? "Customer" : "Recyclable buyer"}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className={kind === "payment" ? "lg:col-span-2" : ""}>
            <Label htmlFor="party" required>{kind === "payment" ? "Supplier" : partyType === "CUSTOMER" ? "Customer" : "Buyer"}</Label>
            <Select id="party" value={partyId} onChange={(e) => setPartyId(e.target.value)} aria-invalid={!!errors.party}>
              <option value="">Select</option>
              {parties.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
            <FieldError message={errors.party} />
          </div>
          <div>
            <Label htmlFor="date" required>Date</Label>
            <Input id="date" type="date" value={head.date} onChange={(e) => setHead({ ...head, date: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="amount" required>Amount (₹)</Label>
            <Input id="amount" type="number" step="0.01" inputMode="decimal" value={head.amount} onChange={(e) => setHead({ ...head, amount: e.target.value })} aria-invalid={!!errors.amount} className="font-semibold" />
            <FieldError message={errors.amount} />
          </div>
          <div>
            <Label htmlFor="mode" required>Mode</Label>
            <Select id="mode" value={head.mode} onChange={(e) => setHead({ ...head, mode: e.target.value })}>
              {MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="accountId" required>{kind === "payment" ? "Paid From" : "Deposited To"}</Label>
            <Select id="accountId" value={head.accountId} onChange={(e) => setHead({ ...head, accountId: e.target.value })} aria-invalid={!!errors.accountId}>
              <option value="">Select account</option>
              {accounts.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </Select>
            <FieldError message={errors.accountId} />
          </div>
          <div>
            <Label htmlFor="reference">Reference (UTR / cheque no.)</Label>
            <Input id="reference" value={head.reference} onChange={(e) => setHead({ ...head, reference: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="remarks">Remarks</Label>
            <Input id="remarks" value={head.remarks} onChange={(e) => setHead({ ...head, remarks: e.target.value })} />
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
          <h3 className="text-sm font-semibold text-navy-800">Allocate against open {kind === "payment" ? "bills" : "invoices"}</h3>
          <Button type="button" variant="outline" size="sm" onClick={autoAllocate} disabled={!docs.length || !amount}><Wand2 /> Auto-allocate (oldest first)</Button>
        </div>
        {loading ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500"><Loader2 className="mr-2 inline size-4 animate-spin" />Loading open documents…</p>
        ) : docs.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">{partyId ? "No open documents. The full amount will be kept as an advance (unallocated)." : "Select a party to see open documents."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr><th className="px-4 py-2">Document</th><th className="px-4 py-2">Date</th><th className="px-4 py-2">Due</th><th className="px-4 py-2 text-right">Amount</th><th className="px-4 py-2 text-right">Balance</th><th className="w-40 px-4 py-2 text-right">Allocate</th></tr>
              </thead>
              <tbody className="num divide-y divide-slate-100">
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-2 font-medium">{d.number}{d.docType === "EXPENSE" && <span className="ml-1 text-xs text-slate-500">(expense)</span>}</td>
                    <td className="px-4 py-2">{formatDate(d.date)}</td>
                    <td className="px-4 py-2">{d.dueDate ? formatDate(d.dueDate) : ""}</td>
                    <td className="px-4 py-2 text-right">{money(d.total)}</td>
                    <td className="px-4 py-2 text-right">{money(d.balance)}</td>
                    <td className="px-4 py-1.5"><Input type="number" step="0.01" className="text-right" value={alloc[d.id] ?? ""} onChange={(e) => setAlloc({ ...alloc, [d.id]: e.target.value })} aria-label={`Allocate to ${d.number}`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="num flex flex-wrap justify-end gap-6 border-t border-slate-100 bg-slate-50/50 px-4 py-2.5 text-sm">
          <span>Amount <b>{money(amount)}</b></span>
          <span>Allocated <b>{money(allocated)}</b></span>
          <span className={cn(r2(amount - allocated) > 0 ? "text-amber-700" : "text-slate-600")}>Unallocated (advance) <b>{money(r2(amount - allocated))}</b></span>
        </div>
      </div>
      <FieldError message={errors.alloc} />
      <Button type="button" onClick={submit} disabled={saving}>{saving && <Loader2 className="animate-spin" />} {kind === "payment" ? "Save Payment" : kind === "allocate" ? "Allocate" : "Save Receipt"}</Button>
    </div>
  );
}
