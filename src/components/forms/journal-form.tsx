"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { journalAction } from "@/app/actions/accounts";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Select } from "@/components/ui/input";
import { useDialogClose } from "./confirm-action";
import type { Option } from "./entity-form";

type L = { accountId: string; debit: string; credit: string };
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function JournalForm({ accounts, today }: { accounts: Option[]; today: string }) {
  const [date, setDate] = useState(today);
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<L[]>([{ accountId: "", debit: "", credit: "" }, { accountId: "", debit: "", credit: "" }]);
  const [err, setErr] = useState<string>();
  const [pending, start] = useTransition();
  const router = useRouter();
  const close = useDialogClose();
  const dr = r2(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
  const cr = r2(lines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
  const set = (i: number, p: Partial<L>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div><Label htmlFor="jdate" required>Date</Label><Input id="jdate" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="sm:col-span-2"><Label htmlFor="narr" required>Narration</Label><Input id="narr" value={narration} onChange={(e) => setNarration(e.target.value)} /></div>
      </div>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_7rem_7rem_2rem] gap-2">
            <Select value={l.accountId} onChange={(e) => set(i, { accountId: e.target.value })} aria-label={`Account ${i + 1}`}>
              <option value="">Select account</option>
              {accounts.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </Select>
            <Input type="number" step="0.01" placeholder="Debit" className="text-right" value={l.debit} onChange={(e) => set(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} />
            <Input type="number" step="0.01" placeholder="Credit" className="text-right" value={l.credit} onChange={(e) => set(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} />
            <button type="button" className="text-slate-400 hover:text-red-600" onClick={() => setLines(lines.length > 2 ? lines.filter((_, j) => j !== i) : lines)} aria-label="Remove line"><Trash2 className="size-4" /></button>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <Button type="button" variant="ghost" size="sm" onClick={() => setLines([...lines, { accountId: "", debit: "", credit: "" }])}><Plus /> Add line</Button>
        <p className={`num text-sm ${dr === cr && dr > 0 ? "text-brand-700" : "text-amber-700"}`}>Debit {dr.toFixed(2)} · Credit {cr.toFixed(2)} {dr === cr && dr > 0 ? "· Balanced" : "· Not balanced"}</p>
      </div>
      <FieldError message={err} />
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await journalAction({ date, narration, lines: lines.filter((l) => l.accountId).map((l) => ({ accountId: l.accountId, debit: l.debit || 0, credit: l.credit || 0 })) });
            if (!r.ok) return void setErr(r.error);
            toast.success("Journal posted");
            close?.();
            router.refresh();
          })
        }
      >
        {pending && <Loader2 className="animate-spin" />} Post Journal
      </Button>
    </div>
  );
}
