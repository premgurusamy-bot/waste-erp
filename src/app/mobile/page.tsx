import { Apple, Download, Smartphone, Trash2 } from "lucide-react";
import { headers } from "next/headers";
import { lanAddresses } from "@/server/mobile";

export const metadata = { title: "Mobile App" };

export default async function MobilePage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  const ua = h.get("user-agent") ?? "";
  const iphone = /iPhone|iPad|iPod/i.test(ua);
  const port = host.split(":")[1] ?? "3000";
  // On the office computer itself "localhost" is no use to a phone; show the network address instead.
  const proto = h.get("x-forwarded-proto") ?? "http";
  const address = /^(localhost|127\.)/.test(host) ? (lanAddresses(port)[0] ?? `http://${host}`) : `${proto}://${host}`;
  const shown = address.replace(/^http:\/\//, "");

  const android = (
    <Card icon={<Smartphone className="size-5" />} title="Android phone">
      <a href="/downloads/GreenCycle-ERP.apk" download className="flex h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 font-semibold text-white hover:bg-brand-700">
        <Download className="size-5" /> Download the app
      </a>
      <Steps
        items={[
          "Tap Download the app. When the download finishes, tap Open.",
          "If the phone says “install unknown apps” is blocked, tap Settings, allow your browser, then go back.",
          "Tap Install, then Open.",
          <>Type the server address <b className="font-mono">{shown}</b> and tap Connect.</>,
          "Sign in with your usual username and password.",
        ]}
      />
    </Card>
  );
  const ios = (
    <Card icon={<Apple className="size-5" />} title="iPhone">
      <Steps
        items={[
          <>Open <b className="font-mono">{shown}/mobile</b> in <b>Safari</b> (this page).</>,
          "Tap the Share button (square with an arrow), then Add to Home Screen.",
          "Tap Add. GreenCycle now opens from its own icon, full screen.",
        ]}
      />
    </Card>
  );

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-navy-800 px-5 pb-8 pt-10 text-white">
        <div className="mx-auto max-w-xl">
          <div className="flex items-center gap-3">
            <img src="/icon.svg" alt="" className="size-9" />
            <span className="text-lg font-semibold">GreenCycle ERP</span>
          </div>
          <h1 className="mt-6 text-2xl font-semibold">Install the mobile app</h1>
          <p className="mt-1 text-navy-200">For drivers, weighbridge and field staff.{address.startsWith("https://") ? " Works anywhere with internet." : " The phone must be on the office Wi-Fi."}</p>
          <p className="mt-4 inline-block rounded-lg bg-white/10 px-3 py-1.5 text-sm">
            Server address: <b className="font-mono text-brand-300">{shown}</b>
          </p>
        </div>
      </header>
      <main className="mx-auto max-w-xl space-y-4 px-4 py-6">
        {iphone ? <>{ios}{android}</> : <>{android}{ios}</>}
        <Card icon={<Trash2 className="size-5" />} title="Uninstall">
          <Steps
            items={[
              <><b>Android:</b> in the app open your name (top right) → <b>App settings</b> → <b>Uninstall app</b>. Or press and hold the GreenCycle icon → <b>Uninstall</b>.</>,
              <><b>iPhone:</b> press and hold the GreenCycle icon → <b>Remove App</b> → <b>Delete from Home Screen</b>.</>,
              "Uninstalling only removes the app from the phone. All company data stays safe on the office server.",
            ]}
          />
        </Card>
        <p className="pt-2 text-center text-sm">
          <a href="/login" className="font-medium text-brand-700 underline">Continue in the browser instead</a>
        </p>
      </main>
    </div>
  );
}

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-navy-800">
        <span className="flex size-9 items-center justify-center rounded-full bg-brand-50 text-brand-700">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="mt-4 space-y-3">
      {items.map((s, i) => (
        <li key={i} className="flex gap-3 text-sm text-slate-700">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-navy-800 text-xs font-semibold text-white">{i + 1}</span>
          <span className="pt-0.5">{s}</span>
        </li>
      ))}
    </ol>
  );
}
