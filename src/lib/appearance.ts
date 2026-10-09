import { z } from "zod";

/** Colour scales (50…900) a customer can choose from. Values follow the Tailwind palettes. */
type Scale = [string, string, string, string, string, string, string, string, string, string];
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

export const THEMES: Record<string, { label: string; scale: Scale }> = {
  green: { label: "Green", scale: ["#ecfdf3", "#d1fadf", "#a6f4c5", "#6ce9a6", "#32d583", "#12b76a", "#039855", "#027a48", "#05603a", "#054f31"] },
  blue: { label: "Blue", scale: ["#eff6ff", "#dbeafe", "#bfdbfe", "#93c5fd", "#60a5fa", "#3b82f6", "#2563eb", "#1d4ed8", "#1e40af", "#1e3a8a"] },
  teal: { label: "Teal", scale: ["#f0fdfa", "#ccfbf1", "#99f6e4", "#5eead4", "#2dd4bf", "#14b8a6", "#0d9488", "#0f766e", "#115e59", "#134e4a"] },
  purple: { label: "Purple", scale: ["#f5f3ff", "#ede9fe", "#ddd6fe", "#c4b5fd", "#a78bfa", "#8b5cf6", "#7c3aed", "#6d28d9", "#5b21b6", "#4c1d95"] },
  orange: { label: "Orange", scale: ["#fff7ed", "#ffedd5", "#fed7aa", "#fdba74", "#fb923c", "#f97316", "#ea580c", "#c2410c", "#9a3412", "#7c2d12"] },
  red: { label: "Red", scale: ["#fff1f2", "#ffe4e6", "#fecdd3", "#fda4af", "#fb7185", "#f43f5e", "#e11d48", "#be123c", "#9f1239", "#881337"] },
};

/** Menu (sidebar) colours. They also tint headings, which use the same scale. */
export const MENU_COLOURS: Record<string, { label: string; scale: Scale }> = {
  navy: { label: "Navy", scale: ["#eef3fa", "#d6e2f2", "#aec4e4", "#7e9fcf", "#4f78b4", "#335b96", "#244677", "#1b365d", "#142844", "#0d1b2f"] },
  charcoal: { label: "Charcoal", scale: ["#f8fafc", "#f1f5f9", "#e2e8f0", "#cbd5e1", "#94a3b8", "#64748b", "#475569", "#334155", "#1e293b", "#0f172a"] },
  forest: { label: "Forest", scale: ["#f0f7f4", "#d9ece3", "#b3d9c7", "#80bfa0", "#4d9f78", "#2f7d59", "#236246", "#1c4e38", "#163c2c", "#0f2a1f"] },
  maroon: { label: "Maroon", scale: ["#fbf1f3", "#f5dde2", "#ebbcc6", "#db8f9f", "#c25e74", "#a13d55", "#842d43", "#6b2437", "#521b2a", "#38121d"] },
  indigo: { label: "Indigo", scale: ["#eef0fb", "#d9ddf5", "#b5bdeb", "#8a95db", "#5f6cc6", "#4450a8", "#363f88", "#2c336d", "#222852", "#171b38"] },
};

export const TEXT_SIZES = { sm: { label: "Small", px: 14 }, md: { label: "Normal", px: 16 }, lg: { label: "Large", px: 17.5 } } as const;

export const appearanceSchema = z.object({
  theme: z.enum(Object.keys(THEMES) as [string, ...string[]]),
  menuColour: z.enum(Object.keys(MENU_COLOURS) as [string, ...string[]]),
  menuStyle: z.enum(["full", "compact"]),
  pageWidth: z.enum(["full", "centered"]),
  textSize: z.enum(["sm", "md", "lg"]),
});
export type AppearanceOptions = z.infer<typeof appearanceSchema>;
export type Appearance = AppearanceOptions & { logo: string | null; loginImage: string | null };

export const DEFAULT_APPEARANCE: Appearance = { theme: "green", menuColour: "navy", menuStyle: "full", pageWidth: "full", textSize: "md", logo: null, loginImage: null };

/** CSS that swaps the brand and menu colour scales; Tailwind utilities read these variables. */
export function themeCss(a: Appearance) {
  const t = THEMES[a.theme] ?? THEMES.green;
  const m = MENU_COLOURS[a.menuColour] ?? MENU_COLOURS.navy;
  const vars = [
    ...STEPS.map((s, i) => `--color-brand-${s}:${t.scale[i]}`),
    ...STEPS.map((s, i) => `--color-navy-${s}:${m.scale[i]}`),
  ];
  return `:root{${vars.join(";")}}html{font-size:${TEXT_SIZES[a.textSize].px}px}`;
}

/** The two main colours, for PDFs: accent bar and heading colour. */
export function pdfColours(a: Appearance) {
  return { accent: (THEMES[a.theme] ?? THEMES.green).scale[6], heading: (MENU_COLOURS[a.menuColour] ?? MENU_COLOURS.navy).scale[7] };
}

/** Public URL of an uploaded branding image; the file name changes on every upload, so it can be cached. */
export const brandingUrl = (file: string | null) => (file ? `/branding/${encodeURIComponent(file)}` : null);
