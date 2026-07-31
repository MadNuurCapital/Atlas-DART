"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CalendarCheck,
  Users,
  Briefcase,
  History,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/today", label: "Today", icon: CalendarCheck },
  { href: "/appointments", label: "Appts", icon: Users },
  { href: "/cases", label: "Cases", icon: Briefcase },
  { href: "/history", label: "History", icon: History },
] as const;

/**
 * Fixed bottom navigation for the advisor pages.
 *
 * Bottom rather than top because this is a phone-first application and the
 * bottom of the screen is where a thumb actually reaches. Hidden on desktop,
 * where the sidebar in the app layout takes over.
 */
export function BottomNav({
  needsSubmission = false,
}: {
  needsSubmission?: boolean;
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="glass fixed inset-x-0 bottom-0 z-40 border-x-0 border-b-0 pb-safe md:hidden"
    >
      <ul className="grid grid-cols-5">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  // min-h-14 keeps every target comfortably above the 44px
                  // minimum even on a small phone.
                  "flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-medium transition-colors",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="relative">
                  <Icon className="size-5" aria-hidden="true" />
                  {/* A red dot on Today until it is submitted. Visible from
                      every screen, so nobody has to go looking for it. */}
                  {href === "/today" && needsSubmission && (
                    <span
                      data-testid="today-badge"
                      aria-label="Not submitted yet"
                      className="absolute -right-1 -top-0.5 size-2.5 rounded-full bg-status-absent ring-2 ring-card"
                    />
                  )}
                </span>
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
