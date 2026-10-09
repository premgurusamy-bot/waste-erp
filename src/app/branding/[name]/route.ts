import { NextResponse } from "next/server";
import { readBrandingImage } from "@/server/branding";

/** Public: the company logo and sign-in picture (shown on the sign-in page, before anyone signs in). */
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const img = await readBrandingImage((await params).name);
  if (!img) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(img.buf), {
    headers: { "Content-Type": img.mime, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
  });
}
