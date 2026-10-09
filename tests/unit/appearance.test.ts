import { describe, expect, it } from "vitest";
import { appearanceSchema, DEFAULT_APPEARANCE, pdfColours, themeCss } from "@/lib/appearance";
import { sniffImage } from "@/server/branding";

describe("Appearance", () => {
  it("builds CSS variables for the chosen theme, menu colour and text size", () => {
    const css = themeCss({ ...DEFAULT_APPEARANCE, theme: "blue", menuColour: "maroon", textSize: "lg" });
    expect(css).toContain("--color-brand-600:#2563eb");
    expect(css).toContain("--color-navy-800:#521b2a");
    expect(css).toContain("font-size:17.5px");
  });
  it("only accepts the listed choices", () => {
    expect(appearanceSchema.safeParse({ theme: "green", menuColour: "navy", menuStyle: "compact", pageWidth: "centered", textSize: "sm" }).success).toBe(true);
    expect(appearanceSchema.safeParse({ theme: "pink", menuColour: "navy", menuStyle: "full", pageWidth: "full", textSize: "md" }).success).toBe(false);
  });
  it("gives PDFs the theme colours", () => {
    expect(pdfColours({ ...DEFAULT_APPEARANCE, theme: "teal" }).accent).toBe("#0d9488");
  });
  it("recognises pictures by content, not by file name", () => {
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.mime).toBe("image/png");
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe("image/jpeg");
    expect(sniffImage(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
  });
});
