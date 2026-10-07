import { NextResponse } from "next/server";
import { getCtx } from "@/server/auth/current-user";
import { toActionError } from "@/server/errors";
import { saveDocument } from "@/server/services/documents";

export async function POST(req: Request) {
  try {
    const ctx = await getCtx();
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
    const doc = await saveDocument(
      ctx,
      { name: file.name, type: file.type, buffer: Buffer.from(await file.arrayBuffer()) },
      {
        category: String(form.get("category") || "OTHER"),
        entityType: (form.get("entityType") as string) || null,
        entityId: (form.get("entityId") as string) || null,
        description: (form.get("description") as string) || null,
      },
    );
    return NextResponse.json({ id: doc.id, originalName: doc.originalName });
  } catch (e) {
    const r = toActionError(e);
    return NextResponse.json({ error: r.error }, { status: 400 });
  }
}
