"use client";

import { useEffect, useState } from "react";
import { CircleAlert, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Logo } from "@/components/brand/logo";

/**
 * Whether this is a stale build rather than a real fault.
 *
 * After a deploy, the browser may still be running the previous version of the
 * app. Navigating then asks for a piece of code that no longer exists, and the
 * failed import surfaces here as a crash - which looks identical to a bug but
 * is fixed entirely by reloading. It is especially easy to hit on a phone,
 * where an installed app can sit in the background for days.
 */
function isStaleBuild(error: Error): boolean {
  return (
    error.name === "ChunkLoadError" ||
    /Loading chunk|Loading CSS chunk|dynamically imported module|Importing a module script failed/i.test(
      error.message,
    )
  );
}

const RELOAD_FLAG = "dart-reloaded-for-stale-build";

/**
 * What a consultant sees when something breaks.
 *
 * Without this they get Next.js's default error screen, which on a phone looks
 * like the app is gone. The most likely cause by far is a momentary problem
 * reaching the database, and the most likely fix is genuinely to try again.
 *
 * The technical detail is deliberately on the page rather than only in a log.
 * Nobody here has a browser console open, and "something went wrong" with no
 * detail is unreportable - it turns every fault into a guessing game for
 * whoever has to fix it.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Read once, at mount, before the effect below can change it. Deriving this
  // rather than setting state from the effect keeps the render pure: the value
  // is already knowable when this screen first appears.
  const [reloadedAlready] = useState(
    () =>
      typeof window !== "undefined" &&
      window.sessionStorage.getItem(RELOAD_FLAG) === "1",
  );

  const stale = isStaleBuild(error) && reloadedAlready;

  useEffect(() => {
    // Netlify captures this; the digest is what ties it to a specific request.
    console.error(
      "[app] unhandled error",
      error.digest,
      error.name,
      error.message,
    );

    if (!isStaleBuild(error)) {
      // The app is running current code, so let a future stale build reload.
      sessionStorage.removeItem(RELOAD_FLAG);
      return;
    }

    // Reload once and only once. A reload loop is worse than the error.
    if (sessionStorage.getItem(RELOAD_FLAG)) return;

    sessionStorage.setItem(RELOAD_FLAG, "1");
    window.location.reload();
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 py-12">
      <Logo />

      <Card className="w-full">
        <CardContent className="space-y-4 pt-5 text-center">
          <CircleAlert
            className="mx-auto size-8 text-status-late"
            aria-hidden="true"
          />

          <div>
            <h1 className="font-semibold">
              {stale ? "Please reload the app" : "Something went wrong"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {stale
                ? "A newer version has been released and this one is out of date. Close the app completely, then open it again."
                : "This is usually a momentary problem reaching the server. Trying again normally fixes it."}
            </p>
          </div>

          <Button onClick={reset} className="w-full">
            <RotateCcw aria-hidden="true" />
            Try again
          </Button>

          <details className="text-left">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Technical details
            </summary>
            <p className="mt-2 break-words rounded-md bg-muted px-2.5 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {error.name}: {error.message || "no message"}
              {error.digest ? ` (${error.digest})` : ""}
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Send this to your administrator if it keeps happening.
            </p>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}
