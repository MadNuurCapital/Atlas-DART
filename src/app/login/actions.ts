"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const credentialsSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter your email")
    .email("That does not look like an email address"),
  password: z.string().min(1, "Enter your password"),
  redirectTo: z.string().optional(),
});

export type LoginState = {
  error?: string;
  fieldErrors?: { email?: string; password?: string };
};

export async function signIn(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    redirectTo: formData.get("redirectTo") ?? undefined,
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      fieldErrors: {
        email: fieldErrors.email?.[0],
        password: fieldErrors.password?.[0],
      },
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Deliberately vague. Distinguishing "no such account" from "wrong
    // password" would tell an attacker which email addresses are real.
    return { error: "Those details did not match. Please try again." };
  }

  revalidatePath("/", "layout");

  // Only ever redirect to a path on this site - an absolute URL here would be
  // an open redirect.
  const target = parsed.data.redirectTo;
  redirect(target && target.startsWith("/") && !target.startsWith("//") ? target : "/dashboard");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
