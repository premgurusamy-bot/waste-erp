"use client";

import { AlertTriangle, Calculator, Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createInvoiceAction, previewBillingAction } from "@/app/actions/billing";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Select, Textarea } from "@/components/ui/input";
import type { Option } from "./entity-form";

type PLine = { key: string; description: string; billingMethod: string | null; quantity: number; unit: string; rate: number; gstRate: number; weighmentIds: string[]; collectionIds: string[] };
type MLine = { description: string; quantity: string; unit: string; rate: string; gstRate: string };
const money = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function InvoiceForm({ customers, sites, defaults, defaultGst }: { customers: Option[]; sites: Option[]; defaults: { date: string; periodFrom: string; periodTo: string; customerId?: string }; defaultGst: number }) {
  const router = useRouter();
  const [head, setHead] = useState({ customerId: defaults.customerId ?? "", siteId: "", date: defaults.date, periodFrom: defaults.periodFrom, periodTo: defaults.periodTo, notes: "" });
  const [preview, setPreview] = useState<{ lines: PLine[]; warnings: string[] } | null>(null);
  const [manual, setManual] = useState<MLine[]>([]);
  const [err, setErr] = useState<string>();
  const [loading, startPreview] = useTransition();
  const [saving, startSave] = useTransition();

  const runPreview = () => {
    if (!head.customerId) return setErr("Select a customer");
    setErr(undefined);
    startPreview(async () => {
      const r = await previewBillingAction({ customerId: head.customerId, siteId: head.siteId || undefined, periodFrom: head.periodFrom, periodTo: head.periodTo });
      if (!r.ok) return void setErr(r.error);
      setPreview(r.data as any);
    });
  };
  const autoTotal = (preview?.lines ?? []).reduce((s, l) => s + r2(l.quantity * l.rate), 0);
  const manTotal = manual.reduce((s, l) => s + r2((Number(l.quantity) || 0) * (Number(l.rate) || 0)), 0);
  const tax = (preview?.lines ?? []).reduce((s, l) => s + r2((r2(l.quantity * l.rate) * l.gstRate) / 100), 0) + manual.reduce((s, l) => s + r2((r2((Number(l.quantity) || 0) * (Number(l.rate) || 0)) * (Number(l.gstRate) || 0)) / 100), 0);

  const create = () =>
    startSave(async () => {
      const r = await createInvoiceAction({ ...head, includeAuto: true, manualLines: manual.filter((m) => m.description && Number(m.quantity) > 0) });
      if (!r.ok) return void (setErr(r.error), toast.error(r.error));
      toast.success(`Invoice ${(r.data as any).number} created`);
      router.push(`/invoices/${(r.data as any).id}`);
    });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Label htmlFor="customerId" required>Customer</Label>
          <Select id="customerId" value={head.customerId} onChange={(e) => { setHead({ ...head, customerId: e.target.value, siteId: "" }); setPreview(null); }}>
            <option value="">Select customer</option>
            {customers.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="siteId">Site (optional)</Label>
          <Select id="siteId" value={head.siteId} onChange={(e) => { setHead({ ...head, siteId: e.target.value }); setPreview(null); }}>
            <option value="">All sites</option>
            {sites.filter((s) => s.parent === head.customerId).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="periodFrom" required>Period From</Label>
          <Input id="periodFrom" type="date" value={head.periodFrom} onChange={(e) => { setHead({ ...head, periodFrom: e.target.value }); setPreview(null); }} />
        </div>
        <div>
          <Label htmlFor="periodTo" required>Period To</Label>
          <Input id="periodTo" type="date" value={head.periodTo} onChange={(e) => { setHead({ ...head, periodTo: e.target.value }); setPreview(null); }} />
        </div>
      </div>
      <Button type="button" variant="navy" onClick={runPreview} disabled={loading}>{loading ? <Loader2 className="animate-spin" /> : <Calculator />} Calculate billable charges</Button>
      <FieldError message={err} />

      {preview && (
        <>
          {preview.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {preview.warnings.map((w, i) => <p key={i} className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{w}</p>)}
            </div>
          )}
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr><th className="px-3 py-2">Description</th><th className="px-3 py-2">Method</th><th className="px-3 py-2 text-right">Quantity</th><th className="px-3 py-2 text-right">Rate</th><th className="px-3 py-2 text-right">GST %</th><th className="px-3 py-2 text-right">Amount (Qty × Rate)</th><th className="w-8" /></tr>
              </thead>
              <tbody className="num divide-y divide-slate-100">
                {preview.lines.length === 0 && manual.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">No unbilled weighments, trips or monthly charges for this period. You can add manual lines below.</td></tr>}
                {preview.lines.map((l) => (
                  <tr key={l.key} data-testid="bill-line">
                    <td className="px-3 py-2">{l.description}</td>
                    <td className="px-3 py-2 text-xs">{l.billingMethod}</td>
                    <td className="px-3 py-2 text-right">{l.quantity.toLocaleString("en-IN", { maximumFractionDigits: 3 })} {l.unit}</td>
                    <td className="px-3 py-2 text-right">{money(l.rate)}</td>
                    <td className="px-3 py-2 text-right">{l.gstRate}%</td>
                    <td className="px-3 py-2 text-right font-medium">{money(r2(l.quantity * l.rate))}</td>
                    <td />
                  </tr>
                ))}
                {manual.map((m, i) => (
                  <tr key={`m${i}`}>
                    <td className="px-3 py-2"><Input value={m.description} placeholder="Description" onChange={(e) => setManual(manual.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} /></td>
                    <td className="px-3 py-2 text-xs">MANUAL</td>
                    <td className="px-3 py-2"><div className="flex gap-1"><Input className="w-20 text-right" type="number" value={m.quantity} onChange={(e) => setManual(manual.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} /><Input className="w-16" value={m.unit} onChange={(e) => setManual(manual.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} /></div></td>
                    <td className="px-3 py-2"><Input className="text-right" type="number" value={m.rate} onChange={(e) => setManual(manual.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} /></td>
                    <td className="px-3 py-2"><Input className="w-16 text-right" type="number" value={m.gstRate} onChange={(e) => setManual(manual.map((x, j) => (j === i ? { ...x, gstRate: e.target.value } : x)))} /></td>
                    <td className="px-3 py-2 text-right">{money(r2((Number(m.quantity) || 0) * (Number(m.rate) || 0)))}</td>
                    <td className="px-2"><button type="button" onClick={() => setManual(manual.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600" aria-label="Remove"><Trash2 className="size-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex flex-wrap items-start justify-between gap-4 border-t border-slate-100 bg-slate-50/50 px-3 py-3">
              <Button type="button" variant="ghost" size="sm" onClick={() => setManual([...manual, { description: "", quantity: "1", unit: "NOS", rate: "", gstRate: String(defaultGst) }])}><Plus /> Add manual line</Button>
              <dl className="num grid grid-cols-[auto_8rem] gap-x-6 gap-y-1 text-sm">
                <dt className="text-slate-500">Taxable value</dt><dd className="text-right">{money(r2(autoTotal + manTotal))}</dd>
                <dt className="text-slate-500">GST (approx.)</dt><dd className="text-right">{money(r2(tax))}</dd>
                <dt className="font-semibold text-navy-800">Estimated total</dt><dd className="text-right font-semibold text-navy-800" data-testid="bill-total">{money(r2(autoTotal + manTotal + tax))}</dd>
              </dl>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="date" required>Invoice Date</Label>
              <Input id="date" type="date" value={head.date} onChange={(e) => setHead({ ...head, date: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="notes">Notes on invoice</Label>
              <Textarea id="notes" rows={1} value={head.notes} onChange={(e) => setHead({ ...head, notes: e.target.value })} />
            </div>
          </div>
          <p className="text-xs text-slate-500">GST split (CGST/SGST or IGST), round-off and due date are finalised by the server when the invoice is created. The billed weighments and trips are locked to this invoice.</p>
          <Button type="button" onClick={create} disabled={saving || (preview.lines.length === 0 && manual.length === 0)}>{saving && <Loader2 className="animate-spin" />} Create Invoice</Button>
        </>
      )}
    </div>
  );
}
