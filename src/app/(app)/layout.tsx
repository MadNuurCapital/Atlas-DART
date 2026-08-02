import Link from "next/link";
import { KeyRound, Bell } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/app-shell/bottom-nav";
import { SideNav } from "@/components/app-shell/side-nav";
import { SubmissionNag } from "@/components/app-shell/submission-nag";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { signOut } from "@/app/login/actions";
import { Toaster } from "@/components/ui/sonner";
import { formatSgDate, sgToday } from "@/lib/sg-date";
import { nagBusinessDate } from "@/lib/nag";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();
  const isAdmin = profile.role === "admin";
  const today = sgToday();

  // Which day the nag is about. Between midnight and 6am it is still
  // yesterday - today has barely started and nobody owes anything for it yet.
  const nagDate = nagBusinessDate();

  // One cheap query, once, in the layout. It drives both the nag banner and
  // the badge on the Today tab, so the answer is fetched in one place rather
  // than on every page that wants to know.
  const supabase = await createClient();
  const { data: nagSubmission } = await supabase
    .from("daily_submissions")
    .select("status")
    .eq("user_id", profile.id)
    .eq("business_date", nagDate)
    .maybeSingle();

  const submittedToday = nagSubmission?.status === "submitted";
  const firstName = profile.full_name.split(" ")[0];

  return (
    // spatial-wash paints two fixed pools of brand colour behind everything.
    // Fixed, so they do not travel with the scroll - that stillness is what
    // makes the tiles read as floating above a space rather than printed on it.
    <div className="spatial-wash flex min-h-dvh">
      <SideNav isAdmin={isAdmin} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-30 flex items-center justify-between gap-3 border-x-0 border-t-0 px-4 py-3">
          {/* Same on the phone. -m-1 p-1 gives the tap target some room
              without moving the mark off the header's optical baseline. */}
          <Link
            href="/dashboard"
            aria-label="Atlas DART — go to your dashboard"
            className="-m-1 rounded-lg p-1 outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:hidden"
          >
            <Logo showWordmark={false} />
          </Link>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{profile.full_name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {formatSgDate(today)}
              {isAdmin && " · Admin"}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Button asChild variant="ghost" size="sm">
              <Link href="/notifications" aria-label="Reminder settings">
                <Bell aria-hidden="true" />
              </Link>
            </Button>

            {/* Anyone handed a temporary password needs somewhere to change
                it. Without this the invite dialog's advice is unfollowable. */}
            <Button asChild variant="ghost" size="sm">
              <Link href="/set-password" aria-label="Change password">
                <KeyRound aria-hidden="true" />
              </Link>
            </Button>

            <form action={signOut}>
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </header>

        {/* pb-24 clears the fixed bottom navigation on mobile. */}
        <main className="flex-1 space-y-4 px-4 pb-24 pt-4 md:px-6 md:pb-10 md:pt-6">
          <SubmissionNag submitted={submittedToday} firstName={firstName} />
          {children}
        </main>
      </div>

      <BottomNav needsSubmission={!submittedToday} />
      <Toaster />
    </div>
  );
}
