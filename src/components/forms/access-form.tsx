"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { ActionResult } from "@/server/errors";

type Props = { publicUrl: string; clientId: string; hasSecret: boolean; disabled: boolean; action: (v: Record<string, unknown>) => Promise<ActionResult<any>> };

export function AccessForm({ publicUrl, clientId, hasSecret, disabled, action }: Props) {
  const router = useRouter();
  const [v, setV] = useState({ publicUrl, clientId, clientSecret: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const field = (k: keyof typeof v, label: string, help: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <Label htmlFor={k}>{label}</Label>
      <Input id={k} value={v[k]} disabled={disabled} onChange={(e) => setV({ ...v, [k]: e.target.value })} {...props} />
      {errors[k] ? <p className="mt-1 text-xs text-red-600">{errors[k]}</p> : <p className="mt-1 text-xs text-slate-500">{help}</p>}
    </div>
  );
  return (
    <div className="space-y-4">
      {field("publicUrl", "Public web address", "The internet address of this GreenCycle, from the remote-access setup. Example: https://erp.yourcompany.in", { placeholder: "https://erp.yourcompany.in" })}
      {field("clientId", "Google Client ID", "From Google Cloud Console → Credentials. Ends with .apps.googleusercontent.com", { placeholder: "1234…apps.googleusercontent.com" })}
      {field("clientSecret", "Google Client Secret", hasSecret ? "Saved. Leave blank to keep it, or paste a new one to replace it." : "From the same Google screen.", { type: "password", autoComplete: "off", placeholder: hasSecret ? "•••••••• (saved)" : "GOCSPX-…" })}
      {!disabled && (
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await action(v);
              if (!r.ok) {
                setErrors(r.fieldErrors ?? {});
                return void toast.error(r.error);
              }
              setErrors({});
              setV({ ...v, clientSecret: "" });
              toast.success("Saved");
              router.refresh();
            })
          }
        >
          {pending && <Loader2 className="animate-spin" />} Save
        </Button>
      )}
    </div>
  );
}
