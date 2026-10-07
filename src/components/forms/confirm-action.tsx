"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useContext, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Label, Textarea } from "@/components/ui/input";
import type { ActionResult } from "@/server/errors";

/** Button + confirmation dialog for cancel / void / activate actions. Optionally asks for a reason. */
export function ConfirmAction({
  label,
  title,
  description,
  action,
  requireReason,
  variant = "outline",
  size = "sm",
  icon,
  confirmLabel = "Confirm",
  successMessage = "Done",
  redirectTo,
}: {
  label: string;
  title: string;
  description?: string;
  action: (reason: string) => Promise<ActionResult<any>>;
  requireReason?: boolean;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  icon?: React.ReactNode;
  confirmLabel?: string;
  successMessage?: string;
  redirectTo?: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const router = useRouter();
  const submit = () => {
    if (requireReason && reason.trim().length < 3) {
      setError("Please enter a reason (at least 3 characters).");
      return;
    }
    start(async () => {
      const res = await action(reason.trim());
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      toast.success(successMessage);
      setOpen(false);
      setReason("");
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(undefined); }}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size}>
          {icon}
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent title={title} description={description}>
        {requireReason && (
          <div className="mb-4">
            <Label htmlFor="reason" required>Reason</Label>
            <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain why (recorded in the audit trail)" />
          </div>
        )}
        {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
          <Button variant={variant === "default" || variant === "navy" ? variant : "destructive"} onClick={submit} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const CloseCtx = createContext<(() => void) | null>(null);
/** Forms rendered inside a FormDialog call this after a successful save to close it. */
export function useDialogClose() {
  return useContext(CloseCtx);
}

/** A dialog that hosts any form (e.g. assign vehicle, add rate). Children may be server-rendered. */
export function FormDialog({
  label,
  title,
  description,
  children,
  variant = "outline",
  size = "sm",
  icon,
  wide,
}: {
  label: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  icon?: React.ReactNode;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size}>
          {icon}
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent title={title} description={description} className={wide ? "max-w-3xl" : undefined}>
        <CloseCtx.Provider value={() => setOpen(false)}>{children}</CloseCtx.Provider>
      </DialogContent>
    </Dialog>
  );
}
