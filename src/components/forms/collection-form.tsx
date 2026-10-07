"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Camera, CheckCircle2, Loader2, LocateFixed, MapPin } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { createCollectionAction } from "@/app/actions/operations";
import { uploadFile } from "@/components/shared/upload-button";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { collectionSchema } from "@/lib/validation";
import type { Option } from "./entity-form";

type Props = {
  customers: Option[];
  sites: Option[];
  wasteTypes: Option[];
  vehicles: Option[];
  drivers: Option[];
  defaults: Record<string, string>;
  /** Large, simple layout for phones in the field. */
  field?: boolean;
  lockParty?: boolean;
  redirectTo: string;
};

export function CollectionForm({ customers, sites, wasteTypes, vehicles, drivers, defaults, field, lockParty, redirectTo }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [photo, setPhoto] = useState<File | null>(null);
  const [gps, setGps] = useState<string>("");
  const form = useForm<Record<string, any>>({ resolver: zodResolver(collectionSchema as any), defaultValues: { status: "COMPLETED", ...defaults } });
  const { register, handleSubmit, formState: { errors }, watch, setValue, getValues, setError } = form;
  const customerId = watch("customerId");
  const status = watch("status");
  const big = field ? "h-12 text-base" : "";

  const captureGps = () => {
    if (!navigator.geolocation) return toast.error("Location is not available on this device.");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setValue("latitude", p.coords.latitude.toFixed(6));
        setValue("longitude", p.coords.longitude.toFixed(6));
        setGps(`${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}`);
      },
      () => toast.error("Could not read location. Check location permission."),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const submit = () =>
    start(async () => {
      const values = getValues();
      if (photo) {
        try {
          const doc = await uploadFile(photo, { category: "COLLECTION_PHOTO", entityType: "collection" });
          values.photoDocumentId = doc.id;
        } catch (e) {
          toast.error(`Photo upload failed: ${(e as Error).message}`);
          return;
        }
      }
      const res = await createCollectionAction(values);
      if (!res.ok) {
        toast.error(res.error);
        for (const [k, m] of Object.entries(res.fieldErrors ?? {})) setError(k, { message: m });
        return;
      }
      toast.success("Collection recorded");
      router.push(redirectTo);
      router.refresh();
    });

  const sel = (name: string, label: string, options: Option[], required = true, locked = false) => (
    <div>
      <Label htmlFor={name} required={required}>{label}</Label>
      <Select id={name} {...register(name)} className={cn(big, locked && "pointer-events-none bg-slate-100")} tabIndex={locked ? -1 : undefined} aria-invalid={!!errors[name]}>
        <option value="">Select {label.toLowerCase()}</option>
        {options.filter((o) => name !== "siteId" || !o.parent || o.parent === customerId).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
      <FieldError message={errors[name]?.message as string} />
    </div>
  );

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className={cn("space-y-4", field && "text-base")}>
      <div className={cn("grid gap-4", field ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3")}>
        {!field && (
          <div>
            <Label htmlFor="collectionDate" required>Date & Time</Label>
            <Input id="collectionDate" type="datetime-local" {...register("collectionDate")} aria-invalid={!!errors.collectionDate} />
            <FieldError message={errors.collectionDate?.message as string} />
          </div>
        )}
        {sel("customerId", "Customer", customers, true, lockParty)}
        {sel("siteId", "Site", sites, true, lockParty)}
        {sel("wasteTypeId", "Waste Type", wasteTypes)}
        {sel("vehicleId", "Vehicle", vehicles)}
        {sel("driverId", "Driver", drivers, false)}
        {!field && (
          <div>
            <Label htmlFor="estimatedQty">Estimated Quantity (KG)</Label>
            <Input id="estimatedQty" type="number" inputMode="decimal" step="any" {...register("estimatedQty")} />
          </div>
        )}
        <div>
          <Label htmlFor="actualQty" required={status !== "NOT_COLLECTED"}>Actual Quantity (KG)</Label>
          <Input id="actualQty" type="number" inputMode="decimal" step="any" {...register("actualQty")} className={cn(field && "h-14 text-2xl font-semibold")} aria-invalid={!!errors.actualQty} placeholder="0" />
          <FieldError message={errors.actualQty?.message as string} />
        </div>
      </div>

      <div>
        <Label>Completion Status</Label>
        <div className="grid grid-cols-3 gap-2">
          {[
            ["COMPLETED", "Completed", "border-brand-500 bg-brand-50 text-brand-800"],
            ["PARTIAL", "Partial", "border-amber-500 bg-amber-50 text-amber-800"],
            ["NOT_COLLECTED", "Not collected", "border-red-500 bg-red-50 text-red-800"],
          ].map(([v, l, on]) => (
            <button
              type="button"
              key={v}
              onClick={() => setValue("status", v)}
              className={cn("rounded-lg border-2 px-2 font-medium transition", field ? "h-14 text-sm" : "h-10 text-xs", status === v ? on : "border-slate-200 bg-white text-slate-600")}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={cn("flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-white px-3 text-slate-600 hover:border-brand-500", field ? "h-16" : "h-11 text-sm")}>
          <Camera className="size-5" />
          {photo ? <span className="truncate text-brand-700">{photo.name}</span> : "Take / attach photo"}
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </label>
        <button type="button" onClick={captureGps} className={cn("flex items-center justify-center gap-2 rounded-lg border-2 border-slate-200 bg-white px-3 text-slate-600 hover:border-brand-500", field ? "h-16" : "h-11 text-sm")}>
          {gps ? <MapPin className="size-5 text-brand-600" /> : <LocateFixed className="size-5" />}
          {gps || "Capture GPS location"}
        </button>
      </div>

      <div>
        <Label htmlFor="remarks">Remarks</Label>
        <Textarea id="remarks" {...register("remarks")} rows={2} placeholder="Bins, segregation quality, access issues…" />
      </div>

      <Button type="submit" size={field ? "xl" : "md"} className={cn(field && "w-full")} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Submit Collection
      </Button>
    </form>
  );
}
