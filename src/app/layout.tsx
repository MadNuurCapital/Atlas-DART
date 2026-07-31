import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Atlas DART",
    template: "%s · Atlas DART",
  },
  description:
    "Advisor Tracking, Learning & Assistance System for Integrated Barakah Wealth Advisory.",
  // Internal tool - keep it out of search results entirely.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Not maximum-scale=1: pinch-zoom must stay available. Field inputs are
  // already 16px so iOS will not auto-zoom on focus.
  //
  // Two entries so the browser chrome matches the page in either theme - one
  // value would leave a bright bar above a dark app, which is the detail that
  // makes an installed PWA look like a website in a frame.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef3f8" },
    { media: "(prefers-color-scheme: dark)", color: "#070d14" },
  ],
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
