"use client";

import { Loader2, Paperclip } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export const CATEGORY_LABELS: Record<string, string> = {
  WEIGHBRIDGE_SLIP: "Weighbridge slip",
  CUSTOMER_AGREEMENT: "Customer agreement",
  INVOICE: "Invoice",
  VEHICLE_DOCUMENT: "Vehicle document",
  DRIVER_DOCUMENT: "Driver document",
  PURCHASE_BILL: "Purchase bill",
  EXPENSE_BILL: "Expense bill",
  COLLECTION_PHOTO: "Collection photo",
  OTHER: "Other",
};

/** Upload a file and link it to a record. Returns the new document id via onUploaded. */
export async function uploadFile(file: File, meta: { category: string; entityType?: string; entityId?: string; description?: string }) {
  const fd = new FormData();
  fd.set("file", file);
  for (const [k, v] of Object.entries(meta)) if (v) fd.set(k, v);
  const res = await fetch("/api/documents", { method: "POST", body: fd });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Upload failed");
  return json as { id: string; originalName: string };
}

export function UploadButton({
  category,
  entityType,
  entityId,
  label = "Attach file",
  accept = ".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.docx",
  categories,
}: {
  category: string;
  entityType?: string;
  entityId?: string;
  label?: string;
  accept?: string;
  categories?: string[];
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [cat, setCat] = useState(category);
  const router = useRouter();
  return (
    <div className="flex items-center gap-2">
      {categories && (
        <select value={cat} onChange={(e) => setCat(e.target.value)} className="h-8 rounded-lg border border-slate-300 px-2 text-xs" aria-label="Document category">
          {categories.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>
          ))}
        </select>
      )}
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusy(true);
          try {
            await uploadFile(f, { category: cat, entityType, entityId });
            toast.success("File attached");
            router.refresh();
          } catch (err) {
            toast.error((err as Error).message);
          } finally {
            setBusy(false);
            e.target.value = "";
          }
        }}
      />
      <Button type="button" variant="outline" size="sm" onClick={() => ref.current?.click()} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <Paperclip />}
        {label}
      </Button>
    </div>
  );
}
