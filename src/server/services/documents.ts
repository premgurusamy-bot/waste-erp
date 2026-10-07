import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { audit } from "../audit";
import { assertCan, can, type Ctx } from "../context";
import { AppError } from "../errors";

export const DOCUMENT_CATEGORIES = [
  "WEIGHBRIDGE_SLIP",
  "CUSTOMER_AGREEMENT",
  "INVOICE",
  "VEHICLE_DOCUMENT",
  "DRIVER_DOCUMENT",
  "PURCHASE_BILL",
  "EXPENSE_BILL",
  "COLLECTION_PHOTO",
  "OTHER",
] as const;

const ALLOWED: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

// Magic-number check so a renamed executable cannot be uploaded as a "PDF".
function sniff(buf: Buffer, mime: string): boolean {
  const hex = buf.subarray(0, 8).toString("hex");
  if (mime === "application/pdf") return buf.subarray(0, 5).toString() === "%PDF-";
  if (mime === "image/jpeg") return hex.startsWith("ffd8ff");
  if (mime === "image/png") return hex.startsWith("89504e47");
  if (mime === "image/webp") return buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP";
  if (mime.includes("openxmlformats")) return hex.startsWith("504b0304");
  return false;
}

export function uploadDir() {
  return path.resolve(process.env.UPLOAD_DIR || "./storage/uploads");
}

const ENTITY_PERMISSION: Record<string, string> = {
  collection: "collections.manage",
  weighment: "weighments.manage",
  vehicle: "vehicles.manage",
  driver: "drivers.manage",
  customer: "customers.manage",
  contract: "contracts.manage",
  purchase: "purchases.manage",
  expense: "expenses.manage",
  invoice: "billing.manage",
  sale: "sales.manage",
};

export async function saveDocument(
  ctx: Ctx,
  file: { name: string; type: string; buffer: Buffer },
  meta: { category: string; entityType?: string | null; entityId?: string | null; description?: string | null },
) {
  const entityPerm = meta.entityType ? ENTITY_PERMISSION[meta.entityType] : undefined;
  if (!can(ctx, "documents.manage") && !(entityPerm && can(ctx, entityPerm))) assertCan(ctx, "documents.manage");
  const maxMb = Number(process.env.MAX_UPLOAD_MB || 10);
  if (file.buffer.length === 0) throw new AppError("The file is empty.");
  if (file.buffer.length > maxMb * 1024 * 1024) throw new AppError(`File is larger than ${maxMb} MB.`);
  const ext = ALLOWED[file.type];
  if (!ext || !sniff(file.buffer, file.type)) throw new AppError("Only PDF, JPG, PNG, WEBP, XLSX and DOCX files are allowed.");
  if (!DOCUMENT_CATEGORIES.includes(meta.category as any)) throw new AppError("Select a valid document category.");

  const now = new Date();
  const sub = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const storedName = `${sub}/${randomUUID()}.${ext}`;
  const full = path.join(uploadDir(), storedName);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, file.buffer, { mode: 0o640 });

  return prisma.$transaction(async (tx) => {
    const doc = await tx.document.create({
      data: {
        originalName: file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 200),
        storedName,
        mimeType: file.type,
        size: file.buffer.length,
        category: meta.category,
        entityType: meta.entityType ?? null,
        entityId: meta.entityId ?? null,
        description: meta.description ?? null,
        uploadedById: ctx.userId,
      },
    });
    await audit(tx, ctx, { action: "UPLOAD", module: "documents", recordId: doc.id, recordLabel: doc.originalName, newValues: { category: doc.category, entityType: doc.entityType, entityId: doc.entityId, size: doc.size } });
    return doc;
  });
}

export async function readDocument(ctx: Ctx, id: string) {
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc || doc.deletedAt) throw new AppError("Document not found.");
  if (!can(ctx, "documents.view")) {
    const entityView = doc.entityType ? ENTITY_PERMISSION[doc.entityType]?.replace(".manage", ".view") : undefined;
    if (!entityView || !can(ctx, entityView)) assertCan(ctx, "documents.view");
  }
  const full = path.join(uploadDir(), doc.storedName);
  if (!full.startsWith(uploadDir())) throw new AppError("Invalid document path.");
  const data = await readFile(full);
  return { doc, data };
}

/** Soft delete: the file is kept on disk for audit; the record is hidden. */
export async function archiveDocument(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "documents.manage");
  return prisma.$transaction(async (tx) => {
    const doc = await tx.document.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(tx, ctx, { action: "DELETE", module: "documents", recordId: id, recordLabel: doc.originalName, newValues: { archived: true, reason } });
    return doc;
  });
}
