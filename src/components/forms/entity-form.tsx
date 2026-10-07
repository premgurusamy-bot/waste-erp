"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Select, Textarea } from "@/components/ui/input";
import { SCHEMAS, type SchemaKey } from "@/lib/schema-registry";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/server/errors";
import { useDialogClose } from "./confirm-action";

export type Option = { value: string; label: string; parent?: string };
export type FieldDef = {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "datetime" | "time" | "select" | "textarea" | "checkbox" | "email" | "tel" | "password";
  options?: Option[];
  /** For dependent selects: only show options whose `parent` equals the value of this field. */
  filterBy?: string;
  required?: boolean;
  placeholder?: string;
  step?: string;
  span?: 1 | 2 | 3;
  help?: string;
  readOnly?: boolean;
  section?: string;
};

export function EntityForm({
  schemaKey,
  fields,
  defaultValues = {},
  action,
  submitLabel = "Save",
  redirectTo,
  successMessage = "Saved successfully",
  cols = 3,
  onDone,
  cancelHref,
}: {
  schemaKey: SchemaKey;
  fields: FieldDef[];
  defaultValues?: Record<string, unknown>;
  action: (values: Record<string, unknown>) => Promise<ActionResult<any>>;
  submitLabel?: string;
  redirectTo?: string;
  successMessage?: string;
  cols?: 1 | 2 | 3;
  onDone?: () => void;
  cancelHref?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const closeDialog = useDialogClose();
  const form = useForm<Record<string, any>>({
    resolver: zodResolver(SCHEMAS[schemaKey] as any),
    // Hidden values (e.g. parent record IDs) are kept alongside the visible fields.
    defaultValues: { ...defaultValues, ...Object.fromEntries(fields.map((f) => [f.name, defaultValues[f.name] ?? (f.type === "checkbox" ? false : "")])) },
    mode: "onTouched",
  });
  const { register, handleSubmit, formState, watch, setError, getValues } = form;
  const values = watch();

  const onSubmit = () =>
    start(async () => {
      const res = await action(getValues());
      if (!res.ok) {
        toast.error(res.error);
        for (const [k, msg] of Object.entries(res.fieldErrors ?? {})) setError(k, { message: msg });
        return;
      }
      toast.success(res.message ?? successMessage);
      onDone?.();
      closeDialog?.();
      if (redirectTo) router.push(redirectTo.replace(":id", (res.data as any)?.id ?? ""));
      else router.refresh();
    });

  let lastSection: string | undefined;
  const grid = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3" }[cols];
  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      <div className={cn("grid grid-cols-1 gap-4", grid)}>
        {fields.map((f) => {
          const err = formState.errors[f.name]?.message as string | undefined;
          const showSection = f.section && f.section !== lastSection;
          lastSection = f.section ?? lastSection;
          const span = f.type === "textarea" ? cols : f.span ?? 1;
          const id = `f-${f.name}`;
          const common = { id, "aria-invalid": !!err, readOnly: f.readOnly, placeholder: f.placeholder, ...register(f.name) };
          let control: React.ReactNode;
          switch (f.type) {
            case "select": {
              const parent = f.filterBy ? values[f.filterBy] : undefined;
              const opts = (f.options ?? []).filter((o) => !f.filterBy || !o.parent || o.parent === parent);
              control = (
                <Select {...common} tabIndex={f.readOnly ? -1 : undefined} aria-readonly={f.readOnly} className={f.readOnly ? "pointer-events-none bg-slate-100 text-slate-600" : undefined}>
                  <option value="">{f.placeholder ?? `Select ${f.label.toLowerCase()}`}</option>
                  {opts.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
              );
              break;
            }
            case "textarea":
              control = <Textarea {...common} rows={3} />;
              break;
            case "checkbox":
              control = (
                <label htmlFor={id} className="flex h-9 items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" id={id} {...register(f.name)} className="size-4 rounded border-slate-300 accent-brand-600" />
                  {f.help ?? f.label}
                </label>
              );
              break;
            default:
              control = (
                <Input
                  {...common}
                  type={f.type === "datetime" ? "datetime-local" : f.type ?? "text"}
                  step={f.step ?? (f.type === "number" ? "any" : undefined)}
                  inputMode={f.type === "number" ? "decimal" : undefined}
                  className={f.readOnly ? "bg-slate-100 text-slate-600" : undefined}
                />
              );
          }
          return (
            <div key={f.name} className={cn(span === 2 && "sm:col-span-2", span === 3 && "sm:col-span-2 lg:col-span-3")}>
              {showSection && <h3 className="-mt-1 mb-3 border-b border-slate-100 pb-1 text-xs font-semibold uppercase tracking-wide text-navy-600">{f.section}</h3>}
              {f.type !== "checkbox" && <Label htmlFor={id} required={f.required}>{f.label}</Label>}
              {f.type === "checkbox" && <Label>{f.label}</Label>}
              {control}
              {f.help && f.type !== "checkbox" && !err && <p className="mt-1 text-xs text-slate-400">{f.help}</p>}
              <FieldError message={err} />
            </div>
          );
        })}
      </div>
      {(() => {
        const visible = new Set(fields.map((f) => f.name));
        const hidden = Object.entries(formState.errors).filter(([k]) => !visible.has(k));
        return hidden.length ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{hidden.map(([, e]) => String(e?.message ?? "Invalid value")).join(" ")}</p> : null;
      })()}
      <div className="flex items-center gap-2 border-t border-slate-100 pt-4">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          {submitLabel}
        </Button>
        {cancelHref && (
          <Button type="button" variant="ghost" onClick={() => router.push(cancelHref)}>Cancel</Button>
        )}
      </div>
    </form>
  );
}
