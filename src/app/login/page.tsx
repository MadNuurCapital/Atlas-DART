import type { Metadata } from "next";
import { APP_COMPANY, APP_TAGLINE, LogoMark } from "@/components/brand/logo";
import { LoginForm } from "./login-form";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string }>;
}) {
  const { redirectTo } = await searchParams;

  return (
    <main className="spatial-wash flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        {/* The one place the mark is allowed to be large and lit. Everywhere
            else it is a 20px glyph in a header doing a navigational job. */}
        <div className="mb-8 flex flex-col items-center text-center">
          <LogoMark glow className="h-16 w-16" />
          <h1 className="mt-5 text-2xl font-bold uppercase tracking-[0.16em] text-[var(--logo-blue)]">
            Atlas
            <span className="ml-2 text-base font-semibold tracking-[0.3em] text-[var(--logo-blue)]/70">
              DART
            </span>
          </h1>

          {/* The firm, directly under the name. Same typeface and the same
              uppercase-and-letterspaced treatment as the wordmark, a step down
              in size and weight - so it reads as belonging to the lockup
              rather than as a third competing line. */}
          <p className="mt-2.5 max-w-[20rem] text-[11px] font-semibold uppercase leading-relaxed tracking-[0.18em] text-[var(--logo-blue)]/70">
            {APP_COMPANY}
          </p>

          {/* The rule keeps the tagline from reading as part of the firm's
              name, which is what three stacked centred lines otherwise does. */}
          <span
            aria-hidden="true"
            className="mt-3 h-px w-10 bg-[var(--logo-blue)]/25"
          />

          <p className="mt-3 max-w-[19rem] text-xs text-muted-foreground">
            {APP_TAGLINE}
          </p>
        </div>

        {/* glass-strong here, not the default solid tile: there is no data on
            this card to misread, and the login box is the one screen where the
            material is allowed to be the point. */}
        <Card className="glass-strong">
          <CardContent className="pt-5">
            <h2 className="mb-1 text-lg font-semibold">Sign in</h2>
            <p className="mb-6 text-sm text-muted-foreground">
              Use the account your administrator created for you.
            </p>
            <LoginForm redirectTo={redirectTo} />
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Accounts are created by your administrator. There is no public sign-up.
        </p>
      </div>
    </main>
  );
}
