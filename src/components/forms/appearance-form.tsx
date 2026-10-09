"use client";

import { Check, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { brandingUrl, MENU_COLOURS, TEXT_SIZES, THEMES, themeCss, type Appearance, type AppearanceOptions } from "@/lib/appearance";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/server/errors";

type Props = { initial: Appearance; disabled: boolean; action: (v: AppearanceOptions) => Promise<ActionResult<any>> };

export function AppearanceForm({ initial, disabled, action }: Props) {
  const router = useRouter();
  const [v, setV] = useState<AppearanceOptions>({ theme: initial.theme, menuColour: initial.menuColour, menuStyle: initial.menuStyle, pageWidth: initial.pageWidth, textSize: initial.textSize });
  const [pending, start] = useTransition();
  const set = (patch: Partial<AppearanceOptions>) => setV((o) => ({ ...o, ...patch }));
  const changed = (Object.keys(v) as (keyof AppearanceOptions)[]).some((k) => v[k] !== initial[k]);

  // Live preview of colours and text size while choosing; removed again when leaving the page.
  useEffect(() => {
    let el = document.getElementById("appearance-preview") as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = "appearance-preview";
      document.head.appendChild(el);
    }
    el.textContent = themeCss({ ...initial, ...v });
  }, [v, initial]);
  useEffect(() => () => document.getElementById("appearance-preview")?.remove(), []);

  const save = () =>
    start(async () => {
      const r = await action(v);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Appearance saved for all users");
      router.refresh();
    });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ImageSetting kind="logo" title="Company logo" help="Shown in the menu, on the sign-in page and on invoices, slips and reports. A square or wide PNG/JPG works best (max 2 MB)." file={initial.logo} disabled={disabled} />
        <ImageSetting kind="loginImage" title="Sign-in page picture" help="Large picture on the left of the sign-in page, e.g. your plant or trucks. A wide photo (JPG, max 2 MB)." file={initial.loginImage} disabled={disabled} wide />
      </div>

      <Group title="Theme colour" help="Buttons, highlights and the active menu item.">
        <div className="flex flex-wrap gap-3">
          {Object.entries(THEMES).map(([k, t]) => (
            <Swatch key={k} label={t.label} colour={t.scale[6]} selected={v.theme === k} disabled={disabled} onClick={() => set({ theme: k })} />
          ))}
        </div>
      </Group>

      <Group title="Menu colour" help="The left menu and page headings.">
        <div className="flex flex-wrap gap-3">
          {Object.entries(MENU_COLOURS).map(([k, t]) => (
            <Swatch key={k} label={t.label} colour={t.scale[8]} selected={v.menuColour === k} disabled={disabled} onClick={() => set({ menuColour: k })} />
          ))}
        </div>
      </Group>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Group title="Menu style" help="Compact shows icons only, leaving more room for tables.">
          <Choice value={v.menuStyle} disabled={disabled} onChange={(x) => set({ menuStyle: x as AppearanceOptions["menuStyle"] })} options={[["full", "Full"], ["compact", "Compact"]]} />
        </Group>
        <Group title="Page width" help="Centred keeps pages narrower on very wide screens.">
          <Choice value={v.pageWidth} disabled={disabled} onChange={(x) => set({ pageWidth: x as AppearanceOptions["pageWidth"] })} options={[["full", "Full width"], ["centered", "Centred"]]} />
        </Group>
        <Group title="Text size" help="Applies to every screen.">
          <Choice value={v.textSize} disabled={disabled} onChange={(x) => set({ textSize: x as AppearanceOptions["textSize"] })} options={Object.entries(TEXT_SIZES).map(([k, t]) => [k, t.label])} />
        </Group>
      </div>

      {!disabled && (
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <Button onClick={save} disabled={pending || !changed}>
            {pending && <Loader2 className="animate-spin" />} Save appearance
          </Button>
          <Button variant="outline" disabled={pending} onClick={() => setV({ theme: "green", menuColour: "navy", menuStyle: "full", pageWidth: "full", textSize: "md" })}>
            Reset to default
          </Button>
          {changed && <p className="self-center text-sm text-amber-700">Previewing: click Save to keep these changes for everyone.</p>}
        </div>
      )}
    </div>
  );
}

function Group({ title, help, children }: { title: string; help: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-navy-800">{title}</h3>
      <p className="mb-2 text-xs text-slate-500">{help}</p>
      {children}
    </section>
  );
}

function Swatch({ label, colour, selected, disabled, onClick }: { label: string; colour: string; selected: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} aria-pressed={selected} className="flex flex-col items-center gap-1 text-xs text-slate-600 disabled:cursor-not-allowed">
      <span className={cn("flex size-11 items-center justify-center rounded-full ring-offset-2 transition", selected ? "ring-2 ring-slate-800" : "ring-1 ring-slate-200 hover:ring-slate-400")} style={{ backgroundColor: colour }}>
        {selected && <Check className="size-5 text-white" />}
      </span>
      {label}
    </button>
  );
}

function Choice({ value, options, disabled, onChange }: { value: string; options: string[][]; disabled: boolean; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
      {options.map(([k, label]) => (
        <button
          key={k}
          type="button"
          disabled={disabled}
          onClick={() => onChange(k)}
          aria-pressed={value === k}
          className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition", value === k ? "bg-white text-brand-700 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-800")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ImageSetting({ kind, title, help, file, disabled, wide }: { kind: "logo" | "loginImage"; title: string; help: string; file: string | null; disabled: boolean; wide?: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const url = brandingUrl(file);

  async function upload(f: File) {
    setBusy(true);
    try {
      const body = new FormData();
      body.set("kind", kind);
      body.set("file", f);
      const res = await fetch("/api/branding", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) return void toast.error(json.error ?? "Upload failed");
      toast.success(`${title} updated`);
      router.refresh();
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/branding?kind=${kind}`, { method: "DELETE" });
      if (!res.ok) return void toast.error((await res.json()).error ?? "Could not remove");
      toast.success(`${title} removed`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-navy-800">{title}</h3>
      <p className="mb-3 text-xs text-slate-500">{help}</p>
      <div className={cn("mb-3 flex items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50", wide ? "h-36" : "h-28")}>
        {url ? (
          <img src={url} alt={title} className={wide ? "h-full w-full object-cover" : "max-h-24 max-w-[80%] object-contain"} />
        ) : (
          <span className="text-xs text-slate-400">{kind === "logo" ? "Using the standard GreenCycle logo" : "Using the standard design"}</span>
        )}
      </div>
      {!disabled && (
        <div className="flex flex-wrap gap-2">
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label={`Upload ${title}`} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <Button variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? <Loader2 className="animate-spin" /> : <ImagePlus />} {url ? "Change picture" : "Upload picture"}
          </Button>
          {url && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={remove} className="text-red-600">
              <Trash2 /> Remove
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
