import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { appearanceSchema, DEFAULT_APPEARANCE, type Appearance } from "@/lib/appearance";
import { audit } from "./audit";
import { assertCan, type Ctx } from "./context";
import { AppError } from "./errors";
import { uploadDir } from "./services/documents";

const KEYS = { theme: "appearance.theme", menuColour: "appearance.menuColour", menuStyle: "appearance.menuStyle", pageWidth: "appearance.pageWidth", textSize: "appearance.textSize", logo: "appearance.logo", loginImage: "appearance.loginImage" } as const;
export type BrandingImage = "logo" | "loginImage";
const MAX_BYTES = 2 * 1024 * 1024;

/** The company's look, read once per request. Falls back to defaults if the database is unavailable. */
export const getAppearance = cache(async (): Promise<Appearance> => {
  try {
    const rows = await prisma.setting.findMany({ where: { key: { in: Object.values(KEYS) } } });
    const v = (k: string) => rows.find((r) => r.key === k)?.value || undefined;
    const opts = appearanceSchema.safeParse({
      theme: v(KEYS.theme) ?? DEFAULT_APPEARANCE.theme,
      menuColour: v(KEYS.menuColour) ?? DEFAULT_APPEARANCE.menuColour,
      menuStyle: v(KEYS.menuStyle) ?? DEFAULT_APPEARANCE.menuStyle,
      pageWidth: v(KEYS.pageWidth) ?? DEFAULT_APPEARANCE.pageWidth,
      textSize: v(KEYS.textSize) ?? DEFAULT_APPEARANCE.textSize,
    });
    return { ...(opts.success ? opts.data : DEFAULT_APPEARANCE), logo: v(KEYS.logo) ?? null, loginImage: v(KEYS.loginImage) ?? null };
  } catch {
    return DEFAULT_APPEARANCE;
  }
});

async function put(tx: Pick<typeof prisma, "setting">, key: string, value: string) {
  await tx.setting.upsert({ where: { key }, update: { value }, create: { key, value, description: "Appearance" } });
}

export async function saveAppearance(ctx: Ctx, input: unknown) {
  assertCan(ctx, "settings.manage");
  const i = appearanceSchema.parse(input);
  const before = await getAppearance();
  return prisma.$transaction(async (tx) => {
    for (const k of Object.keys(i) as (keyof typeof i)[]) await put(tx, KEYS[k], i[k]);
    await audit(tx, ctx, {
      action: "UPDATE",
      module: "settings",
      recordId: "appearance",
      recordLabel: "Appearance",
      oldValues: { theme: before.theme, menuColour: before.menuColour, menuStyle: before.menuStyle, pageWidth: before.pageWidth, textSize: before.textSize },
      newValues: i,
    });
    return i;
  });
}

const brandingDir = () => path.join(uploadDir(), "branding");

/** Identify the image from its first bytes; the file name and browser-sent type are not trusted. */
export function sniffImage(buf: Buffer): { ext: string; mime: string } | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png", mime: "image/png" };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return { ext: "webp", mime: "image/webp" };
  return null;
}

export const MIME_BY_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

export async function saveBrandingImage(ctx: Ctx, kind: BrandingImage, buf: Buffer) {
  assertCan(ctx, "settings.manage");
  if (buf.length > MAX_BYTES) throw new AppError("The picture is larger than 2 MB. Please use a smaller picture.");
  const type = sniffImage(buf);
  if (!type) throw new AppError("Only PNG, JPG and WebP pictures can be used.");
  await mkdir(brandingDir(), { recursive: true });
  const name = `${kind === "logo" ? "logo" : "login"}-${Date.now()}.${type.ext}`;
  await writeFile(path.join(brandingDir(), name), buf);
  const old = (await getAppearance())[kind];
  await prisma.$transaction(async (tx) => {
    await put(tx, KEYS[kind], name);
    await audit(tx, ctx, { action: "UPDATE", module: "settings", recordId: KEYS[kind], recordLabel: kind === "logo" ? "Company logo" : "Sign-in picture", oldValues: { file: old }, newValues: { file: name } });
  });
  if (old) await unlink(path.join(brandingDir(), path.basename(old))).catch(() => undefined);
  return { file: name };
}

export async function removeBrandingImage(ctx: Ctx, kind: BrandingImage) {
  assertCan(ctx, "settings.manage");
  const old = (await getAppearance())[kind];
  await prisma.$transaction(async (tx) => {
    await put(tx, KEYS[kind], "");
    await audit(tx, ctx, { action: "UPDATE", module: "settings", recordId: KEYS[kind], recordLabel: kind === "logo" ? "Company logo" : "Sign-in picture", oldValues: { file: old }, newValues: { file: null } });
  });
  if (old) await unlink(path.join(brandingDir(), path.basename(old))).catch(() => undefined);
}

/** Read an uploaded branding image by its stored name (only names this module created). */
export async function readBrandingImage(name: string) {
  if (!/^(logo|login)-\d+\.(png|jpg|webp)$/.test(name)) return null;
  try {
    return { buf: await readFile(path.join(brandingDir(), name)), mime: MIME_BY_EXT[name.split(".").pop()!] };
  } catch {
    return null;
  }
}

/** Logo bytes for PDFs (PDF supports PNG and JPG only). */
export async function pdfLogo(): Promise<Buffer | null> {
  const a = await getAppearance();
  if (!a.logo || a.logo.endsWith(".webp")) return null;
  return (await readBrandingImage(a.logo))?.buf ?? null;
}
