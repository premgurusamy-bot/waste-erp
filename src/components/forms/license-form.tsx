"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/input";
import type { ActionResult } from "@/server/errors";

export function LicenseForm({ action }: { action: (key: string) => Promise<ActionResult<any>> }) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <Label htmlFor="licenseKey">New licence key</Label>
      <Textarea id="licenseKey" rows={4} className="font-mono text-xs" placeholder="GCERP-…" value={key} onChange={(e) => setKey(e.target.value)} />
      <Button
        disabled={pending || !key.trim()}
        onClick={() =>
          start(async () => {
            const r = await action(key);
            if (!r.ok) return void toast.error(r.error);
            toast.success(`Licence installed for ${r.data.licensee}, valid until ${r.data.expires}`);
            setKey("");
            router.refresh();
          })
        }
      >
        {pending && <Loader2 className="animate-spin" />} Install Licence
      </Button>
    </div>
  );
}
