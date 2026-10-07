"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { purchaseAction, salesAction } from "@/app/actions/trade";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type TradeItem = { value: string; label: string; unit: string; gstRate: number; rate: number; hsn: string | null };
export type Party = { value: string; label: string; state: string | null };
type Line = { itemId: string; description: string; quantity: string; unit: string; rate: string; gstRate: string; hsnCode: string };

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function TradeForm({
  mode,
  parties,
  items,
  locations,
  stock,
  companyState,
  roundOff,
  defaults,
}: {
  mode: "sale" | "purchase";
  parties: Party[];
  items: TradeItem[];
  locations: { value: string; label: string }[];
  stock?: Record<string, number>;
  companyState: string;
  roundOff: boolean;
  defaults: { date: string; locationId: string };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const sale = mode === "sale";
  const blank: Line = { itemId: "", description: "", quantity: "", unit: sale ? "KG" : "NOS", rate: "", gstRate: "", hsnCode: "" };
  const [head, setHead] = useState({ partyId: "", date: defaults.date, locationId: defaults.locationId, vehicleNumber: "", billNumber: "", billDate: "", remarks: "" });
  const [lines, setLines] = useState<Line[]>([{ ...blank }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const party = parties.find((p) => p.value === head.partyId);
  const inter = !!party?.state && party.state !== companyState;
  const itemById = new Map(items.map((i) => [i.value, i]));

  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pickItem = (i: number, itemId: string) => {
    const it = itemById.get(itemId);
    setLine(i, { itemId, ...(it ? { description: it.label, unit: it.unit, gstRate: String(it.gstRate), hsnCode: it.hsn ?? "", ...(sale ? { rate: String(it.rate || "") } : {}) } : {}) });
  };
  const calc = lines.map((l) => {
    const taxable = r2((Number(l.quantity) || 0) * (Number(l.rate) || 0));
    const g = Number(l.gstRate) || 0;
    const tax = inter ? r2((taxable * g) / 100) : r2((taxable * g) / 200) * 2;
    return { taxable, tax, total: r2(taxable + tax) };
  });
  const subtotal = r2(calc.reduce((s, c) => s + c.taxable, 0));
  const tax = r2(calc.reduce((s, c) => s + c.tax, 0));
  const gross = r2(subtotal + tax);
  const total = roundOff ? Math.round(gross) : gross;
  const avail = (itemId: string) => stock?.[`${itemId}|${head.locationId}`] ?? 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!head.partyId) errs.partyId = `Select the ${sale ? "buyer" : "supplier"}`;
    if (sale && !head.locationId) errs.locationId = "Select the stock location";
    const valid = lines.filter((l) => (sale ? l.itemId : l.description) && Number(l.quantity) > 0);
    if (!valid.length) errs.lines = "Add at least one line with quantity";
    if (sale) for (const l of valid) if (Number(l.quantity) > avail(l.itemId)) errs.lines = `Quantity for ${itemById.get(l.itemId)?.label} exceeds available stock (${avail(l.itemId)} KG).`;
    setErrors(errs);
    if (Object.keys(errs).length) return;
    start(async () => {
      const r = sale
        ? await salesAction({ date: head.date, buyerId: head.partyId, locationId: head.locationId, vehicleNumber: head.vehicleNumber, remarks: head.remarks, items: valid.map((l) => ({ itemId: l.itemId, quantity: l.quantity, rate: l.rate, gstRate: l.gstRate })) })
        : await purchaseAction({ date: head.date, supplierId: head.partyId, billNumber: head.billNumber, billDate: head.billDate, locationId: head.locationId, remarks: head.remarks, items: valid.map((l) => ({ itemId: l.itemId, description: l.description, quantity: l.quantity, unit: l.unit, rate: l.rate, gstRate: l.gstRate, hsnCode: l.hsnCode })) });
      if (!r.ok) {
        toast.error(r.error);
        setErrors({ lines: r.error });
        return;
      }
      toast.success(sale ? "Sale saved, stock reduced and invoice generated" : "Purchase saved");
      router.push(`/${sale ? "sales" : "purchases"}/${(r.data as any).id}`);
    });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <Label htmlFor="party" required>{sale ? "Buyer" : "Supplier"}</Label>
          <Select id="party" value={head.partyId} onChange={(e) => setHead({ ...head, partyId: e.target.value })} aria-invalid={!!errors.partyId}>
            <option value="">Select {sale ? "buyer" : "supplier"}</option>
            {parties.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
          <FieldError message={errors.partyId} />
          {party && <p className="mt-1 text-xs text-slate-500">{inter ? "Inter-state supply: IGST applies" : "Intra-state supply: CGST + SGST apply"}</p>}
        </div>
        <div>
          <Label htmlFor="date" required>Date</Label>
          <Input id="date" type="date" value={head.date} onChange={(e) => setHead({ ...head, date: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="loc" required={sale}>{sale ? "Stock Location" : "Receive at (stock items)"}</Label>
          <Select id="loc" value={head.locationId} onChange={(e) => setHead({ ...head, locationId: e.target.value })} aria-invalid={!!errors.locationId}>
            <option value="">Select location</option>
            {locations.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
          <FieldError message={errors.locationId} />
        </div>
        {sale ? (
          <div>
            <Label htmlFor="veh">Buyer Vehicle No.</Label>
            <Input id="veh" value={head.vehicleNumber} onChange={(e) => setHead({ ...head, vehicleNumber: e.target.value })} />
          </div>
        ) : (
          <>
            <div>
              <Label htmlFor="bill">Supplier Bill No.</Label>
              <Input id="bill" value={head.billNumber} onChange={(e) => setHead({ ...head, billNumber: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="billDate">Bill Date</Label>
              <Input id="billDate" type="date" value={head.billDate} onChange={(e) => setHead({ ...head, billDate: e.target.value })} />
            </div>
          </>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">{sale ? "Material" : "Item / Description"}</th>
              <th className="w-28 px-3 py-2 text-right">Quantity</th>
              {!sale && <th className="w-20 px-3 py-2">Unit</th>}
              <th className="w-28 px-3 py-2 text-right">Rate</th>
              <th className="w-20 px-3 py-2 text-right">GST %</th>
              <th className="w-32 px-3 py-2 text-right">Taxable</th>
              <th className="w-32 px-3 py-2 text-right">Total</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l, i) => (
              <tr key={i} className="align-top">
                <td className="px-3 py-2">
                  <Select value={l.itemId} onChange={(e) => pickItem(i, e.target.value)} aria-label={`Material ${i + 1}`}>
                    <option value="">{sale ? "Select material" : "Non-stock item / service"}</option>
                    {items.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                  {!sale && <Input className="mt-1" placeholder="Description" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} aria-label={`Description ${i + 1}`} />}
                  {sale && l.itemId && <p className={cn("mt-0.5 text-xs", Number(l.quantity) > avail(l.itemId) ? "font-medium text-red-600" : "text-slate-500")}>In stock: {avail(l.itemId).toLocaleString("en-IN")} KG</p>}
                </td>
                <td className="px-3 py-2"><Input type="number" step="any" className="text-right" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} aria-label={`Quantity ${i + 1}`} /></td>
                {!sale && <td className="px-3 py-2"><Input value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} aria-label={`Unit ${i + 1}`} /></td>}
                <td className="px-3 py-2"><Input type="number" step="any" className="text-right" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} aria-label={`Rate ${i + 1}`} /></td>
                <td className="px-3 py-2"><Input type="number" step="any" className="text-right" value={l.gstRate} onChange={(e) => setLine(i, { gstRate: e.target.value })} aria-label={`GST ${i + 1}`} /></td>
                <td className="num px-3 py-2 pt-4 text-right">{money(calc[i].taxable)}</td>
                <td className="num px-3 py-2 pt-4 text-right font-medium">{money(calc[i].total)}</td>
                <td className="px-2 py-2 pt-3">
                  <button type="button" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : [{ ...blank }])} className="text-slate-400 hover:text-red-600" aria-label="Remove line"><Trash2 className="size-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-start justify-between gap-4 border-t border-slate-100 bg-slate-50/50 px-3 py-3">
          <Button type="button" variant="ghost" size="sm" onClick={() => setLines([...lines, { ...blank }])}><Plus /> Add line</Button>
          <dl className="num grid grid-cols-[auto_8rem] gap-x-6 gap-y-1 text-sm">
            <dt className="text-slate-500">Taxable value</dt><dd className="text-right">{money(subtotal)}</dd>
            {inter ? (<><dt className="text-slate-500">IGST</dt><dd className="text-right">{money(tax)}</dd></>) : (<><dt className="text-slate-500">CGST</dt><dd className="text-right">{money(tax / 2)}</dd><dt className="text-slate-500">SGST</dt><dd className="text-right">{money(tax / 2)}</dd></>)}
            {roundOff && <><dt className="text-slate-500">Round off</dt><dd className="text-right">{money(r2(total - gross))}</dd></>}
            <dt className="font-semibold text-navy-800">Total</dt><dd className="text-right text-base font-semibold text-navy-800">{money(total)}</dd>
          </dl>
        </div>
      </div>
      <FieldError message={errors.lines} />
      <div>
        <Label htmlFor="remarks">Remarks</Label>
        <Textarea id="remarks" value={head.remarks} onChange={(e) => setHead({ ...head, remarks: e.target.value })} rows={2} />
      </div>
      <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} {sale ? "Save Sale & Generate Invoice" : "Save Purchase"}</Button>
    </form>
  );
}
