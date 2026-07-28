import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = { title: "Choose a password" };
export const dynamic = "force-dynamic";

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const { welcome } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Reachable only with a session, which the invitation link established.
  if (!user) redirect("/login");

  const isWelcome = welcome === "1";
  const name =
    (user.user_metadata?.full_name as string | undefined)?.split(" ")[0] ??
    undefined;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-secondary/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <Card>
          <CardContent className="pt-5">
            <h1 className="mb-1 text-lg font-semibold">
              {isWelcome
                ? name
                  ? `Welcome, ${name}`
                  : "Welcome"
                : "Choose a new password"}
            </h1>
            <p className="mb-6 text-sm text-muted-foreground">
              {isWelcome
                ? "Choose a password and you are in. You will use this and your email to sign in from now on."
                : "Pick something you have not used here before."}
            </p>
            <SetPasswordForm />
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Signed in as {user.email}
        </p>
      </div>
    </main>
  );
}
