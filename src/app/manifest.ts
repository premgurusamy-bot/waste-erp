import type { MetadataRoute } from "next";

/** Lets phones add GreenCycle to the home screen as a full-screen app (iPhone, and Android without the APK). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GreenCycle ERP",
    short_name: "GreenCycle",
    description: "Waste collection, weighbridge, billing and accounts",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f1f5f9",
    theme_color: "#1b365d",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
