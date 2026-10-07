"use client";

import { AlertTriangle, CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { processingAction } from "@/app/actions/stock";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Option } from "./entity-form";

type Line = { itemId: string; quantity: string };
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const fmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 3 });

export function ProcessingForm({
  inputItems,
  outputItems,
  locations,
  stock,
  defaults,
}: {
  inputItems: Option[];
  outputItems: Option[];
  locations: Option[];
  /** "itemId|locationId" -> available quantity */
  stock: Record<string, number>;
  defaults: { date: string; locationId: string; batchNo: string };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [head, setHead] = useState({ ...defaults, remarks: "" });
  const [inputs, setInputs] = useState<Line[]>([{ itemId: "", quantity: "" }]);
  const [outputs, setOutputs] = useState<Line[]>([{ itemId: "", quantity: "" }]);
  const [rejected, setRejected] = useState("");
  const [loss, setLoss] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const sum = (ls: Line[]) => r3(ls.reduce((s, l) => s + (Number(l.quantity) || 0), 0));
  const inQ = sum(inputs);
  const outQ = sum(outputs);
  const diff = r3(inQ - outQ - (Number(rejected) || 0) - (Number(loss) || 0));
  const avail = (itemId: string) => stock[`${itemId}|${head.locationId}`] ?? 0;

  const lineEditor = (label: string, lines: Line[], set: (l: Line[]) => void, options: Option[], showStock: boolean) => (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-navy-800">{label}</h3>
        <Button type="button" variant="ghost" size="sm" onClick={() => set([...lines, { itemId: "", quantity: "" }])}><Plus /> Add line</Button>
      </div>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_8rem_2rem] items-start gap-2">
            <div>
              <Select value={l.itemId} onChange={(e) => set(lines.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))} aria-label={`${label} material ${i + 1}`}>
                <option value="">Select material</option>
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
              {showStock && l.itemId && (
                <p className={cn("mt-0.5 text-xs", avail(l.itemId) < (Number(l.quantity) || 0) ? "text-red-600" : "text-slate-500")}>Available: {fmt(avail(l.itemId))} KG</p>
              )}
            </div>
            <Input type="number" step="any" inputMode="decimal" placeholder="KG" value={l.quantity} onChange={(e) => set(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} aria-label={`${label} quantity ${i + 1}`} />
            <button type="button" className="mt-2 text-slate-400 hover:text-red-600" onClick={() => set(lines.length > 1 ? lines.filter((_, j) => j !== i) : [{ itemId: "", quantity: "" }])} aria-label="Remove line"><Trash2 className="size-4" /></button>
          </div>
        ))}
      </div>
    </div>
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!head.batchNo.trim()) errs.batchNo = "Batch number is required";
    if (!head.locationId) errs.locationId = "Select the processing location";
    const ins = inputs.filter((l) => l.itemId && Number(l.quantity) > 0);
    const outs = outputs.filter((l) => l.itemId && Number(l.quantity) > 0);
    if (!ins.length) errs.inputs = "Add at least one input with quantity";
    if (diff !== 0) errs.balance = `Input must equal Output + Rejected + Loss. Unexplained difference: ${fmt(diff)} KG`;
    setErrors(errs);
    if (Object.keys(errs).length) return;
    start(async () => {
      const r = await processingAction({ ...head, inputs: ins, outputs: outs, rejectedQty: rejected || 0, lossQty: loss || 0 });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Processing batch posted. Stock updated.");
      router.push(`/processing/${(r.data as any).id}`);
    });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="batchNo" required>Batch Number</Label>
          <Input id="batchNo" value={head.batchNo} onChange={(e) => setHead({ ...head, batchNo: e.target.value })} aria-invalid={!!errors.batchNo} />
          <FieldError message={errors.batchNo} />
        </div>
        <div>
          <Label htmlFor="date" required>Date</Label>
          <Input id="date" type="date" value={head.date} onChange={(e) => setHead({ ...head, date: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="locationId" required>Processing Location</Label>
          <Select id="locationId" value={head.locationId} onChange={(e) => setHead({ ...head, locationId: e.target.value })}>
            <option value="">Select location</option>
            {locations.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <FieldError message={errors.locationId} />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-4">
          {lineEditor("Input · received waste", inputs, setInputs, inputItems, true)}
          <FieldError message={errors.inputs} />
        </div>
        <div className="rounded-xl border border-slate-200 p-4">
          {lineEditor("Output · recovered material", outputs, setOutputs, outputItems, false)}
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
            <div>
              <Label htmlFor="rejected">Rejected Quantity (KG)</Label>
              <Input id="rejected" type="number" step="any" value={rejected} onChange={(e) => setRejected(e.target.value)} />
              <p className="mt-0.5 text-xs text-slate-500">Goes to rejected-waste stock for disposal</p>
            </div>
            <div>
              <Label htmlFor="loss">Process Loss (KG)</Label>
              <div className="flex gap-1">
                <Input id="loss" type="number" step="any" value={loss} onChange={(e) => setLoss(e.target.value)} />
                <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setLoss(String(r3(inQ - outQ - (Number(rejected) || 0))))} title="Set loss to the remaining quantity">Fill</Button>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">Moisture, dust, shrinkage</p>
            </div>
          </div>
        </div>
      </div>
      <div className={cn("flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border-2 px-4 py-3 text-sm", diff === 0 && inQ > 0 ? "border-brand-500 bg-brand-50" : "border-amber-400 bg-amber-50")} data-testid="balance">
        {diff === 0 && inQ > 0 ? <CheckCircle2 className="size-5 text-brand-600" /> : <AlertTriangle className="size-5 text-amber-600" />}
        <span>Input <b className="num">{fmt(inQ)}</b></span>
        <span>= Output <b className="num">{fmt(outQ)}</b></span>
        <span>+ Rejected <b className="num">{fmt(Number(rejected) || 0)}</b></span>
        <span>+ Loss <b className="num">{fmt(Number(loss) || 0)}</b></span>
        <span className={cn("ml-auto font-semibold", diff === 0 ? "text-brand-700" : "text-amber-700")}>{diff === 0 ? "Balanced" : `Difference ${fmt(diff)} KG`}</span>
      </div>
      <FieldError message={errors.balance} />
      <div>
        <Label htmlFor="remarks">Remarks</Label>
        <Textarea id="remarks" value={head.remarks} onChange={(e) => setHead({ ...head, remarks: e.target.value })} rows={2} />
      </div>
      <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} Post Processing Batch</Button>
    </form>
  );
}
