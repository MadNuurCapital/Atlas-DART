"use client";

import { useEffect } from "react";
import { CircleAlert, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Logo } from "@/components/brand/logo";

/**
 * What a consultant sees when something breaks.
 *
 * Without this they get Next.js's default error screen, which on a phone looks
 * like the app is gone. The most likely cause by far is a momentary problem
 * reaching the database, and the most likely fix is genuinely to try again -
 * so that is what this offers, rather than a stack trace nobody can act on.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Netlify captures this; the digest is what ties it to a specific request.
    console.error("[app] unhandled error", error.digest, error.message);
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
            <h1 className="font-semibold">Something went wrong</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              This is usually a momentary problem reaching the server. Trying
              again normally fixes it.
            </p>
          </div>

          <Button onClick={reset} className="w-full">
            <RotateCcw aria-hidden="true" />
            Try again
          </Button>

          <p className="text-xs text-muted-foreground">
            If it keeps happening, tell your administrator
            {error.digest ? ` and quote ${error.digest}` : ""}.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
