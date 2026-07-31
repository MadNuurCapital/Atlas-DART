import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { Card, CardContent } from "@/components/ui/card";
import { CallbackHandler } from "./callback-handler";

export const metadata: Metadata = { title: "Signing you in" };
export const dynamic = "force-dynamic";

/**
 * Where every emailed link lands: invitations, password resets, magic links.
 *
 * Supabase can deliver the session in three different shapes depending on the
 * flow and the email template, so the handler accepts all three rather than
 * betting on one. Doing it client-side is deliberate - the implicit flow puts
 * the tokens in the URL *fragment*, which a browser never sends to a server.
 */
export default function AuthCallbackPage() {
  return (
    <main className="spatial-wash flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <Card>
          <CardContent className="pt-5">
            <CallbackHandler />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
