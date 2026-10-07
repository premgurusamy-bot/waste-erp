"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { emailInvoiceAction } from "@/app/actions/billing";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";

export function EmailInvoiceButton({ id, defaultTo, configured, icon }: { id: string; defaultTo: string; configured: boolean; icon?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(defaultTo);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" size="sm">{icon} Email</Button></DialogTrigger>
      <DialogContent title="Email invoice" description={configured ? "The PDF invoice is attached." : "Email is not configured on this server."}>
        {!configured ? (
          <p className="text-sm text-slate-600">Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and SMTP_FROM in the environment to enable emailing. Meanwhile, download the PDF and send it manually.</p>
        ) : (
          <div className="space-y-4">
            <div><Label htmlFor="to" required>Send to</Label><Input id="to" type="email" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <Button disabled={pending} onClick={() => start(async () => { const r = await emailInvoiceAction(id, to); if (!r.ok) return void toast.error(r.error); toast.success("Invoice emailed"); setOpen(false); router.refresh(); })}>
              {pending && <Loader2 className="animate-spin" />} Send
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
