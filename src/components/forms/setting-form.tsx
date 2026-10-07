"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { ActionResult } from "@/server/errors";

export function SettingForm({ k, value, description, disabled, action }: { k: string; value: string; description: string; disabled?: boolean; action: (k: string, v: string) => Promise<ActionResult<any>> }) {
  const [v, setV] = useState(value);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-72 flex-1">
        <Label htmlFor={k}>{description}</Label>
        <Input id={k} type="number" value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} />
      </div>
      {!disabled && (
        <Button variant="outline" disabled={pending} onClick={() => start(async () => { if (!/^\d+(\.\d+)?$/.test(v)) return void toast.error("Enter a number"); const r = await action(k, v); if (r.ok) toast.success("Saved"); else toast.error(r.error); })}>
          {pending && <Loader2 className="animate-spin" />} Save
        </Button>
      )}
    </div>
  );
}
