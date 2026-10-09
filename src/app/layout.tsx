import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";
import { themeCss } from "@/lib/appearance";
import { getAppearance } from "@/server/branding";

export const metadata: Metadata = {
  title: { default: "GreenCycle ERP", template: "%s | GreenCycle ERP" },
  description: "Non-hazardous waste management ERP: collection, weighment, processing, recycling, billing and accounts",
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "GreenCycle", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1b365d" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const appearance = await getAppearance();
  return (
    <html lang="en-IN">
      <head>
        <style id="appearance">{themeCss(appearance)}</style>
      </head>
      <body>
        {children}
        <Toaster richColors position="top-right" closeButton />
      </body>
    </html>
  );
}
