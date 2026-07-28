import type { MetadataRoute } from "next";

/**
 * PWA manifest.
 *
 * Not decoration: iOS only permits web push from a site that has been added to
 * the Home Screen, and it will only offer that properly for a site with a
 * manifest and a service worker. Without this file, iPhone users cannot
 * receive notifications at all.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DART & Case Tracker",
    short_name: "DART",
    description:
      "Daily DART submissions and signed-case tracking for Integrated Barakah Wealth Advisory.",
    start_url: "/today",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#1e7fa6",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
