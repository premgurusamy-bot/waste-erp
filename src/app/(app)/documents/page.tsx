import { Archive, Download } from "lucide-react";
import Link from "next/link";
import { archiveDocumentAction } from "@/app/actions/admin";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { CATEGORY_LABELS, UploadButton } from "@/components/shared/upload-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { FilterBar, FilterField, FSelect, FText, PageHeader } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { ci, flat, listParams, str, type SP } from "@/lib/list-params";
import { formatDateTime } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { DOCUMENT_CATEGORIES } from "@/server/services/documents";

export const metadata = { title: "Documents" };

const ENTITY_LINK: Record<string, string> = { collection: "/collections", weighment: "/weighments/", vehicle: "/vehicles/", driver: "/drivers/", customer: "/customers/", contract: "/contracts/", purchase: "/purchases/", expense: "/expenses/", invoice: "/invoices/", sale: "/sales/" };

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("documents.view");
  const sp = await searchParams;
  const { page, pageSize, skip, take, q } = listParams(sp);
  const category = str(sp, "category");
  const where = { deletedAt: null, ...(q ? { OR: [{ originalName: ci(q) }, { description: ci(q) }] } : {}), ...(category ? { category } : {}) };
  const [rows, total] = await Promise.all([prisma.document.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }), prisma.document.count({ where })]);
  const uploaders = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.uploadedById).filter(Boolean) as string[] } } });
  const manage = user.permissions.includes("documents.manage");
  return (
    <>
      <PageHeader title="Document Management" description="Weighbridge slips, agreements, vehicle & driver documents, bills and photos linked to their transactions" actions={manage && <UploadButton category="OTHER" categories={[...DOCUMENT_CATEGORIES]} label="Upload" />} />
      <Card>
        <FilterBar reset="/documents">
          <FilterField label="Search" className="min-w-56 flex-1"><FText name="q" defaultValue={q} placeholder="File name" /></FilterField>
          <FilterField label="Category"><FSelect name="category" defaultValue={category} options={DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))} /></FilterField>
        </FilterBar>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          empty="No documents"
          columns={[
            { key: "n", header: "File", cell: (r) => <a href={`/api/documents/${r.id}`} target="_blank" className="font-medium text-navy-700 hover:underline">{r.originalName}</a> },
            { key: "c", header: "Category", cell: (r) => <Badge>{CATEGORY_LABELS[r.category] ?? r.category}</Badge> },
            { key: "e", header: "Linked To", cell: (r) => (r.entityType ? (ENTITY_LINK[r.entityType] && r.entityId ? <Link className="text-navy-700 hover:underline" href={ENTITY_LINK[r.entityType].endsWith("/") ? `${ENTITY_LINK[r.entityType]}${r.entityId}` : ENTITY_LINK[r.entityType]}>{r.entityType}</Link> : r.entityType) : <span className="text-slate-400">General</span>) },
            { key: "s", header: "Size", align: "right", cell: (r) => `${(r.size / 1024).toFixed(0)} KB` },
            { key: "u", header: "Uploaded", cell: (r) => <div className="text-xs">{formatDateTime(r.createdAt)}<div className="text-slate-500">{uploaders.find((u) => u.id === r.uploadedById)?.name}</div></div> },
            {
              key: "a",
              header: "",
              cell: (r) => (
                <div className="flex justify-end gap-1">
                  <a href={`/api/documents/${r.id}?download=1`} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Download"><Download className="size-4" /></a>
                  {manage && <ConfirmAction label="" icon={<Archive />} variant="ghost" title="Archive this document?" description="It will be hidden from lists but kept on disk for audit." requireReason action={archiveDocumentAction.bind(null, r.id)} successMessage="Document archived" />}
                </div>
              ),
            },
          ]}
        />
        <Pagination page={page} pageSize={pageSize} total={total} params={flat(sp)} />
      </Card>
    </>
  );
}
