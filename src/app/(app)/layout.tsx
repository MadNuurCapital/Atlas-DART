import { requireProfile } from "@/lib/auth";
import { BottomNav } from "@/components/app-shell/bottom-nav";
import { SideNav } from "@/components/app-shell/side-nav";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { signOut } from "@/app/login/actions";
import { Toaster } from "@/components/ui/sonner";
import { formatSgDate, sgToday } from "@/lib/sg-date";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();
  const isAdmin = profile.role === "admin";

  return (
    <div className="flex min-h-dvh bg-secondary/30">
      <SideNav isAdmin={isAdmin} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
          <div className="md:hidden">
            <Logo showWordmark={false} />
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{profile.full_name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {formatSgDate(sgToday())}
              {isAdmin && " · Admin"}
            </p>
          </div>

          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
        </header>

        {/* pb-20 clears the fixed bottom navigation on mobile. */}
        <main className="flex-1 px-4 pb-20 pt-4 md:pb-8">{children}</main>
      </div>

      <BottomNav />
      <Toaster />
    </div>
  );
}
