"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CircleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import Link from "next/link";

type State =
  | { kind: "working" }
  | { kind: "failed"; message: string };

/**
 * Turn whatever Supabase put in the URL into a session.
 *
 * Three possible shapes, and which one arrives depends on the flow and on
 * whether the email template has been customised:
 *
 *   1. `#access_token=...&refresh_token=...`  - implicit flow, the default for
 *      Supabase's stock email templates. The tokens are in the fragment, which
 *      browsers never send to the server, so this must be handled here.
 *   2. `?code=...`                            - PKCE flow.
 *   3. `?token_hash=...&type=invite`          - the newer template style.
 *
 * Accepting all three means the link works regardless of how the project is
 * configured, which matters because that configuration lives in a dashboard
 * rather than in this repository.
 */
export function CallbackHandler() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "working" });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const supabase = createClient();
      const url = new URL(window.location.href);
      const hash = new URLSearchParams(url.hash.replace(/^#/, ""));

      // Supabase reports link problems in the fragment too - an expired
      // invitation is by far the most common, and deserves a real explanation
      // rather than a generic failure.
      const errorCode =
        hash.get("error_code") ?? url.searchParams.get("error_code");
      const errorDescription =
        hash.get("error_description") ?? url.searchParams.get("error_description");

      if (errorCode) {
        if (cancelled) return;
        setState({
          kind: "failed",
          message:
            errorCode === "otp_expired"
              ? "That invitation link has expired. Ask your administrator to send a new one."
              : (errorDescription ?? "That link could not be used.").replace(
                  /\+/g,
                  " ",
                ),
        });
        return;
      }

      try {
        const accessToken = hash.get("access_token");
        const refreshToken = hash.get("refresh_token");
        const code = url.searchParams.get("code");
        const tokenHash = url.searchParams.get("token_hash");
        const type = url.searchParams.get("type");

        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
        } else if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (tokenHash && type) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: type as "invite" | "recovery" | "email" | "signup",
          });
          if (error) throw error;
        } else {
          // Nothing to exchange. createBrowserClient may already have picked
          // the session up automatically, so check before giving up.
          const { data } = await supabase.auth.getSession();
          if (!data.session) {
            throw new Error(
              "This link is missing its sign-in details. It may have been opened twice, or truncated by an email client.",
            );
          }
        }

        if (cancelled) return;

        // An invited person has no password yet, so send everyone through the
        // set-password screen. Someone who already has one can skip it.
        const isInvite =
          hash.get("type") === "invite" ||
          hash.get("type") === "recovery" ||
          type === "invite" ||
          type === "recovery";

        router.replace(isInvite ? "/set-password?welcome=1" : "/dashboard");
      } catch (error) {
        if (cancelled) return;
        setState({
          kind: "failed",
          message:
            error instanceof Error
              ? error.message
              : "That link could not be used.",
        });
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (state.kind === "failed") {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2 text-destructive">
          <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div>
            <h1 className="font-semibold">That link did not work</h1>
            <p className="mt-1 text-sm text-muted-foreground">{state.message}</p>
          </div>
        </div>
        <Button asChild className="w-full">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 py-2">
      <Loader2 className="size-5 animate-spin text-primary" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">Signing you in…</p>
    </div>
  );
}
