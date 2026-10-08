import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { assertCan, type Ctx } from "../context.js";
import { audit } from "../audit.js";
import { nextCode } from "../sequence.js";
import { UPLOAD_DIR } from "../config.js";
import { badRequest, notFound } from "../lib/errors.js";
import { plain, pageParams, toDate } from "../lib/util.js";

export const DOC_TYPES = ["LR", "INVOICE", "POD", "EWAY_BILL", "RECEIPT", "EXPENSE_RECEIPT", "VEHICLE_DOC", "DRIVER_DOC", "OTHER"] as const;
export const ENTITY_TYPES = ["TRIP", "CUSTOMER", "TRANSPORTER", "VEHICLE", "DRIVER", "EXPENSE", "INVOICE", "RECEIPT", "PAYMENT"] as const;

/** Allowed uploads, checked by content (magic numbers), not just by the file name. */
function sniff(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return { mime: "application/pdf", ext: ".pdf" };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: ".jpg" };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: ".png" };
  if (buf.length >= 12 && buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return { mime: "image/webp", ext: ".webp" };
  if (buf.length >= 12 && buf.subarray(4, 12).toString().startsWith("ftypheic")) return { mime: "image/heic", ext: ".heic" };
  return null;
}

export async function uploadDocument(ctx: Ctx, file: { path: string; originalname: string; size: number }, meta: any) {
  assertCan(ctx, "documents.upload");
  try {
    const docType = String(meta?.docType ?? "OTHER").toUpperCase();
    if (!DOC_TYPES.includes(docType as any)) throw badRequest("Unknown document type.");
    const entityType = meta?.entityType ? String(meta.entityType).toUpperCase() : null;
    if (entityType && !ENTITY_TYPES.includes(entityType as any)) throw badRequest("Unknown record type.");
    const entityId = meta?.entityId ? String(meta.entityId) : null;
    if (entityId && !/^[0-9a-f-]{36}$/i.test(entityId)) throw badRequest("Invalid record id.");
    const buf = fs.readFileSync(file.path);
    const kind = sniff(buf);
    if (!kind) throw badRequest("Only PDF, JPG, PNG, WEBP or HEIC files can be uploaded.");
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const storedName = `${new Date().toISOString().slice(0, 10)}_${randomBytes(10).toString("hex")}${kind.ext}`;
    fs.copyFileSync(file.path, path.join(UPLOAD_DIR, storedName));
    const sha256 = createHash("sha256").update(buf).digest("hex");
    const safeName = path.basename(file.originalname).replace(/[^\w.\- ()]/g, "_").slice(0, 150) || `upload${kind.ext}`;
    return await prisma.$transaction(async (tx) => {
      const code = await nextCode(tx, "DOC");
      const doc = await tx.document.create({ data: { code, docType, entityType, entityId, fileName: safeName, storedName, mimeType: kind.mime, sizeBytes: buf.length, sha256, notes: meta?.notes ? String(meta.notes).slice(0, 500) : null, uploadedBy: ctx.user.name } });
      if (docType === "POD" && entityType === "TRIP" && entityId) {
        const t = await tx.trip.findUnique({ where: { id: entityId } });
        if (t && ["BOOKED", "ALLOCATED", "LOADED", "IN TRANSIT", "DELIVERED"].includes(t.status)) {
          const today = toDate(new Date().toISOString().slice(0, 10));
          await tx.trip.update({ where: { id: entityId }, data: { status: "POD RECEIVED", podReceivedDate: today, deliveredDate: t.deliveredDate ?? today } });
        }
      }
      if (entityType === "VEHICLE" && entityId && meta?.vehicleDocType) {
        await tx.vehicleDocument.create({ data: { vehicleId: entityId, docType: String(meta.vehicleDocType).slice(0, 30), docNumber: meta.docNumber || null, expiryDate: toDate(meta.expiryDate || null), documentId: doc.id } });
      }
      if (entityType === "DRIVER" && entityId && meta?.driverDocType) {
        await tx.driverDocument.create({ data: { driverId: entityId, docType: String(meta.driverDocType).slice(0, 30), docNumber: meta.docNumber || null, expiryDate: toDate(meta.expiryDate || null), documentId: doc.id } });
      }
      await audit(tx, ctx, "CREATE", { type: "DOCUMENT", id: doc.id, code }, null, doc);
      return plain(doc);
    });
  } finally {
    fs.rmSync(file.path, { force: true });
  }
}

export async function listDocuments(ctx: Ctx, q: any) {
  assertCan(ctx, "documents.view");
  const { skip, take, page, pageSize } = pageParams(q);
  const where: any = {};
  if (q.docType) where.docType = q.docType;
  if (q.entityType) where.entityType = q.entityType;
  if (q.entityId) where.entityId = q.entityId;
  if (q.q) where.OR = [{ code: { contains: q.q, mode: "insensitive" } }, { fileName: { contains: q.q, mode: "insensitive" } }, { notes: { contains: q.q, mode: "insensitive" } }];
  const [rows, total] = await Promise.all([prisma.document.findMany({ where, skip, take, orderBy: { createdAt: "desc" } }), prisma.document.count({ where })]);
  return { rows: plain(rows), total, page, pageSize };
}

export async function documentFile(ctx: Ctx, id: string) {
  assertCan(ctx, "documents.view");
  const d = await prisma.document.findUnique({ where: { id } });
  if (!d) throw notFound();
  const p = path.join(UPLOAD_DIR, path.basename(d.storedName));
  if (!fs.existsSync(p)) throw notFound("The file is not on this computer. Restore the Backup/Documents folder.");
  return { path: p, doc: d };
}
