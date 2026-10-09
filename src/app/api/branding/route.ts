import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/auth/current-user";
import { removeBrandingImage, saveBrandingImage, type BrandingImage } from "@/server/branding";
import { toActionError } from "@/server/errors";
import { assertLicenseWritable } from "@/server/license";

const kindOf = (v: unknown): BrandingImage | null => (v === "logo" || v === "loginImage" ? v : null);

export async function POST(req: Request) {
  try {
    const ctx = await getCtx();
    await assertLicenseWritable();
    const form = await req.formData();
    const kind = kindOf(form.get("kind"));
    const file = form.get("file");
    if (!kind) return NextResponse.json({ error: "Unknown picture type." }, { status: 400 });
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a picture to upload." }, { status: 400 });
    const r = await saveBrandingImage(ctx, kind, Buffer.from(await file.arrayBuffer()));
    revalidatePath("/", "layout");
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: toActionError(e).error }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  try {
    const ctx = await getCtx();
    await assertLicenseWritable();
    const kind = kindOf(new URL(req.url).searchParams.get("kind"));
    if (!kind) return NextResponse.json({ error: "Unknown picture type." }, { status: 400 });
    await removeBrandingImage(ctx, kind);
    revalidatePath("/", "layout");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: toActionError(e).error }, { status: 400 });
  }
}
