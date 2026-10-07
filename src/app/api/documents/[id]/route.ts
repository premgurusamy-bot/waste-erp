import { NextResponse } from "next/server";
import { getCtx } from "@/server/auth/current-user";
import { toActionError } from "@/server/errors";
import { readDocument } from "@/server/services/documents";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getCtx();
    const { id } = await params;
    const { doc, data } = await readDocument(ctx, id);
    const inline = doc.mimeType === "application/pdf" || doc.mimeType.startsWith("image/");
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": doc.mimeType,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${doc.originalName.replace(/[^\w.\- ()]/g, "_")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: toActionError(e).error }, { status: 404 });
  }
}
