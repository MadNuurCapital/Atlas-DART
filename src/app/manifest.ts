import type { MetadataRoute } from "next";

/**
 * PWA manifest.
 *
 * Not decoration: iOS only permits web push from a site that has been added to
 * the Home Screen, and it will only offer that properly for a site with a
 * manifest and a service worker. Without this file, iPhone users cannot
 * receive notifications at all.
 *
 * Renaming here only affects a fresh install. Anyone who added the old "DART"
 * icon to their Home Screen keeps that label until they remove and re-add it;
 * their push subscription is unaffected either way.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Atlas DART",
    short_name: "Atlas",
    description:
      "Advisor Tracking, Learning & Assistance System for Integrated Barakah Wealth Advisory.",
    start_url: "/today",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#eef3f8",
    theme_color: "#0b5a92",
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
