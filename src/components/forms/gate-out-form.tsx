"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { gateOutAction } from "@/app/actions/weighments";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { gateOutSchema } from "@/lib/validation";

const fmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 3 });

/** Net weight is displayed live but computed and stored by the server; it cannot be typed in. */
export function GateOutForm({ weighmentId, gross, defaultTare, now }: { weighmentId: string; gross: number; defaultTare?: number; now: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { register, handleSubmit, watch, formState: { errors }, getValues, setError } = useForm<Record<string, any>>({
    resolver: zodResolver(gateOutSchema as any),
    defaultValues: { weighmentId, tareWeight: defaultTare ?? "", gateOutAt: now },
  });
  const tareRaw = watch("tareWeight");
  const tare = Number(tareRaw);
  const hasTare = tareRaw !== "" && tareRaw !== undefined && Number.isFinite(tare);
  const invalid = hasTare && (tare < 0 || tare >= gross);
  const net = hasTare && !invalid ? gross - tare : null;
  return (
    <form
      noValidate
      onSubmit={handleSubmit(() =>
        start(async () => {
          const r = await gateOutAction(getValues());
          if (!r.ok) {
            toast.error(r.error);
            for (const [k, m] of Object.entries(r.fieldErrors ?? {})) setError(k, { message: m });
            return;
          }
          toast.success(`Gate-out complete. Net weight ${fmt(Number((r.data as any).netWeight))} KG received into stock.`);
          router.refresh();
        }),
      )}
      className="space-y-4"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <Label>Gross Weight (KG)</Label>
          <div className="num flex h-11 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-lg font-semibold">{fmt(gross)}</div>
        </div>
        <div>
          <Label htmlFor="tareWeight" required>Tare Weight (KG)</Label>
          <Input id="tareWeight" type="number" step="any" inputMode="decimal" className="h-11 text-lg font-semibold" {...register("tareWeight")} aria-invalid={!!errors.tareWeight || invalid} autoFocus />
          <FieldError message={(errors.tareWeight?.message as string) ?? (invalid ? (tare < 0 ? "Tare weight cannot be negative" : "Tare must be less than gross weight") : undefined)} />
        </div>
        <div>
          <Label>Net Weight (KG) · calculated</Label>
          <div className="num flex h-11 items-center rounded-lg border-2 border-brand-500 bg-brand-50 px-3 text-lg font-bold text-brand-800" data-testid="net-weight" aria-live="polite">
            {net === null ? "—" : fmt(net)}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="gateOutAt" required>Gate-out Time</Label>
          <Input id="gateOutAt" type="datetime-local" {...register("gateOutAt")} />
          <FieldError message={errors.gateOutAt?.message as string} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="remarks">Remarks</Label>
          <Input id="remarks" {...register("remarks")} />
        </div>
      </div>
      <Button type="submit" disabled={pending || invalid}>
        {pending ? <Loader2 className="animate-spin" /> : <LogOut />} Complete Gate-out
      </Button>
    </form>
  );
}
