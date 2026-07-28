import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "DART & Case Tracker",
    template: "%s · DART & Case Tracker",
  },
  description:
    "Daily DART submissions and signed-case tracking for Integrated Barakah Wealth Advisory.",
  // Internal tool - keep it out of search results entirely.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Not maximum-scale=1: pinch-zoom must stay available. Field inputs are
  // already 16px so iOS will not auto-zoom on focus.
  themeColor: "#1e7fa6",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en-SG"
      className={`${geistSans.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
