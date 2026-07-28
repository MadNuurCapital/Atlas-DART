"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const passwordSchema = z
  .object({
    password: z
      .string()
      .min(10, "Use at least 10 characters")
      .max(200, "That is too long"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Those two passwords do not match",
    path: ["confirm"],
  });

export type SetPasswordResult = {
  ok: boolean;
  message?: string;
  fieldErrors?: { password?: string; confirm?: string };
};

/**
 * Set a password for the signed-in user.
 *
 * Reached after an invitation or a reset link has already established a
 * session. There is no way to call this without one, because the Supabase
 * client here acts as the caller and updateUser needs an authenticated user.
 */
export async function setPassword(
  formData: FormData,
): Promise<SetPasswordResult> {
  const parsed = passwordSchema.safeParse({
    password: String(formData.get("password") ?? ""),
    confirm: String(formData.get("confirm") ?? ""),
  });

  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    return {
      ok: false,
      fieldErrors: {
        password: flat.password?.[0],
        confirm: flat.confirm?.[0],
      },
    };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      message:
        "Your sign-in link has expired. Ask your administrator for a new invitation.",
    };
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) {
    return {
      ok: false,
      message:
        error.message.toLowerCase().includes("different from the old")
          ? "Choose a password you have not used here before."
          : error.message,
    };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}
