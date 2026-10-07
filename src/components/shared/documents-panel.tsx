import { Download, FileText, ImageIcon } from "lucide-react";
import { Section } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/utils";
import { CATEGORY_LABELS, UploadButton } from "./upload-button";

/** Attachments linked to a record, with an upload button when the user may add files. */
export async function DocumentsPanel({
  entityType,
  entityId,
  category,
  categories,
  canUpload,
  title = "Documents & Attachments",
}: {
  entityType: string;
  entityId: string;
  category: string;
  categories?: string[];
  canUpload: boolean;
  title?: string;
}) {
  const docs = await prisma.document.findMany({ where: { entityType, entityId, deletedAt: null }, orderBy: { createdAt: "desc" } });
  return (
    <Section title={title} actions={canUpload && <UploadButton category={category} categories={categories} entityType={entityType} entityId={entityId} />}>
      {docs.length === 0 ? (
        <p className="px-5 py-6 text-sm text-slate-500">No documents attached.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
              {d.mimeType.startsWith("image/") ? <ImageIcon className="size-4 text-slate-400" /> : <FileText className="size-4 text-slate-400" />}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-700">{d.originalName}</p>
                <p className="text-xs text-slate-500">{CATEGORY_LABELS[d.category] ?? d.category} · {(d.size / 1024).toFixed(0)} KB · {formatDateTime(d.createdAt)}</p>
              </div>
              <a href={`/api/documents/${d.id}`} target="_blank" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700" aria-label="Download"><Download className="size-4" /></a>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
