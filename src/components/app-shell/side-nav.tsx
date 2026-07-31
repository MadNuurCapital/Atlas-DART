"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Briefcase,
  Building2,
  CalendarCheck,
  Download,
  GraduationCap,
  History,
  LayoutDashboard,
  ScrollText,
  Shield,
  Table2,
  Target,
  UserCog,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/logo";

const CONSULTANT_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/today", label: "Today", icon: CalendarCheck },
  { href: "/appointments", label: "Appointments", icon: Users },
  { href: "/cases", label: "Cases", icon: Briefcase },
  { href: "/history", label: "History", icon: History },
] as const;

const ADMIN_ITEMS = [
  { href: "/admin", label: "Team overview", icon: Shield },
  { href: "/admin/daily", label: "Daily board", icon: Table2 },
  { href: "/admin/cases", label: "All cases", icon: Briefcase },
  { href: "/admin/coaching", label: "Coaching", icon: GraduationCap },
  { href: "/admin/targets", label: "Targets", icon: Target },
  { href: "/admin/users", label: "People", icon: UserCog },
  { href: "/admin/insurers", label: "Insurers", icon: Building2 },
  { href: "/admin/export", label: "Export", icon: Download },
  { href: "/admin/audit", label: "Audit trail", icon: ScrollText },
] as const;

/** Desktop sidebar. The mobile equivalent is BottomNav. */
export function SideNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  const renderItem = ({
    href,
    label,
    icon: Icon,
  }: {
    href: string;
    label: string;
    icon: typeof LayoutDashboard;
  }) => {
    const active =
      pathname === href ||
      (href !== "/admin" && pathname.startsWith(`${href}/`));
    return (
      <li key={href}>
        <Link
          href={href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
            active
              ? // A left bar rather than a filled pill: at a glance you read
                // one lit edge instead of scanning nine similar blocks.
                "bg-primary/10 text-foreground shadow-[inset_2px_0_0_0_var(--primary)]"
              : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </Link>
      </li>
    );
  };

  return (
    <aside className="glass sticky top-0 hidden h-dvh w-64 shrink-0 overflow-y-auto border-y-0 border-l-0 md:block">
      <div className="p-5">
        <Logo />
      </div>
      <nav aria-label="Primary" className="px-3 pb-6">
        <ul className="space-y-1">{CONSULTANT_ITEMS.map(renderItem)}</ul>

        {isAdmin && (
          <>
            <p className="mt-6 px-3 pb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Management
            </p>
            <ul className="space-y-1">{ADMIN_ITEMS.map(renderItem)}</ul>
          </>
        )}
      </nav>
    </aside>
  );
}
