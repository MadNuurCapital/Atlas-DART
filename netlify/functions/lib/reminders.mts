import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared logic for the two scheduled reminder functions.
 *
 * These run with no user session, so they use the service-role key and bypass
 * Row Level Security by necessity. They are the only place in the codebase
 * that does.
 */

export type MissingPerson = {
  user_id: string;
  full_name: string;
  email: string;
  role: string;
};

export type SendOutcome = {
  userId: string;
  email: string;
  status: "sent" | "failed" | "skipped";
  error?: string;
};

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export function adminClient(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SECRET_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** Today's Singapore date, decided here rather than trusted from the runtime. */
export function sgToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function formatSgDate(date: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T04:00:00Z`));
}

/**
 * Everyone active with no SUBMITTED record for the date. A draft does not
 * count - a half-filled form is not a submission.
 */
export async function findMissing(
  supabase: SupabaseClient,
  businessDate: string,
): Promise<MissingPerson[]> {
  const { data, error } = await supabase.rpc("missing_submissions", {
    p_date: businessDate,
  });

  if (error) throw new Error(`missing_submissions failed: ${error.message}`);
  return (data as MissingPerson[]) ?? [];
}

export async function findAdmins(
  supabase: SupabaseClient,
): Promise<MissingPerson[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("role", "admin")
    .eq("active", true);

  if (error) throw new Error(`admin lookup failed: ${error.message}`);

  return ((data as { id: string; full_name: string; email: string }[]) ?? []).map(
    (a) => ({
      user_id: a.id,
      full_name: a.full_name,
      email: a.email,
      role: "admin",
    }),
  );
}

/**
 * Has this person already been sent this reminder today?
 *
 * The unique key on reminder_logs is the real guarantee, but checking first
 * means a Netlify retry does not attempt a send that would then be discarded.
 */
export async function alreadySent(
  supabase: SupabaseClient,
  userId: string,
  businessDate: string,
  reminderType: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("reminder_logs")
    .select("id, status")
    .eq("user_id", userId)
    .eq("business_date", businessDate)
    .eq("reminder_type", reminderType)
    .maybeSingle();

  // A previous failure is worth retrying; a previous success is not.
  return data?.status === "sent";
}

export async function logReminder(
  supabase: SupabaseClient,
  entry: {
    userId: string;
    businessDate: string;
    reminderType: string;
    status: "sent" | "failed";
    errorMessage?: string;
  },
): Promise<void> {
  // Upsert on the unique key so a retry updates the existing row rather than
  // colliding, and so a failure that later succeeds is recorded as sent.
  const { error } = await supabase.from("reminder_logs").upsert(
    {
      user_id: entry.userId,
      business_date: entry.businessDate,
      reminder_type: entry.reminderType,
      status: entry.status,
      error_message: entry.errorMessage ?? null,
      sent_at: new Date().toISOString(),
    },
    { onConflict: "user_id,business_date,reminder_type" },
  );

  if (error) {
    console.error("[reminder] could not write log row: %s", error.message);
  }
}

/**
 * Whether email is set up at all.
 *
 * Reminders reach the team by push notification, which needs no domain. Email
 * is the optional extra, and until a Resend sender is verified there is
 * nothing to send with. Checking up front means the scheduled runs exit
 * quietly instead of writing one fabricated failure row per person per day -
 * which would both bury real failures and mark the day as already attempted.
 */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.REMINDER_FROM_EMAIL);
}

/** Send one email through Resend. Returns the error text rather than throwing. */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.REMINDER_FROM_EMAIL;

  if (!apiKey || !from) {
    return {
      ok: false,
      error: "RESEND_API_KEY or REMINDER_FROM_EMAIL is not configured",
    };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [opts.to],
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return { ok: false, error: `Resend ${response.status}: ${body.slice(0, 300)}` };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Guard the manual HTTP trigger.
 *
 * Netlify Dev does not fire crons, so these functions need to be invokable by
 * hand - but an unguarded endpoint that emails the whole team is not something
 * to leave open.
 */
export function authoriseManualRun(request: Request): boolean {
  const expected = process.env.REMINDER_TEST_TOKEN;
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const fromQuery = new URL(request.url).searchParams.get("token") ?? "";

  return token === expected || fromQuery === expected;
}

export function appUrl(): string {
  return process.env.APP_URL ?? "";
}

const BRAND_BLUE = "#1e7fa6";

export function consultantEmail(name: string, businessDate: string) {
  const firstName = name.split(" ")[0] ?? name;
  const readableDate = formatSgDate(businessDate);
  const link = appUrl();

  const text = [
    `Assalamualaikum ${firstName}, your DART update for ${readableDate} has not been submitted yet. Please complete it as soon as possible.`,
    link ? `\n\nSubmit here: ${link}/today` : "",
  ].join("");

  const html = `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:520px;color:#4d4d4f;line-height:1.5">
      <p>Assalamualaikum ${escapeHtml(firstName)},</p>
      <p>Your DART update for <strong>${escapeHtml(readableDate)}</strong> has not been submitted yet. Please complete it as soon as possible.</p>
      ${
        link
          ? `<p style="margin:24px 0"><a href="${link}/today" style="background:${BRAND_BLUE};color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Submit today's DART</a></p>`
          : ""
      }
      <p style="color:#6b7280;font-size:13px">Submissions close at 11:59 PM Singapore time.</p>
    </div>`;

  return { subject: "Daily DART Update Missing", text, html };
}

export function adminDigestEmail(
  missing: MissingPerson[],
  businessDate: string,
) {
  const readableDate = formatSgDate(businessDate);
  const link = appUrl();

  if (missing.length === 0) {
    const text = `Everyone submitted their DART update for ${readableDate}. Nothing outstanding.`;
    return {
      subject: `DART: all submitted for ${businessDate}`,
      text,
      html: `<div style="font-family:system-ui,sans-serif;color:#4d4d4f"><p>${escapeHtml(text)}</p></div>`,
    };
  }

  const names = missing.map((m) => m.full_name);
  const text = [
    `${missing.length} ${missing.length === 1 ? "person has" : "people have"} not submitted a DART update for ${readableDate}:`,
    "",
    ...names.map((n) => `  - ${n}`),
    link ? `\n\nTeam board: ${link}/admin/daily` : "",
  ].join("\n");

  const html = `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:520px;color:#4d4d4f;line-height:1.5">
      <p><strong>${missing.length}</strong> ${missing.length === 1 ? "person has" : "people have"} not submitted a DART update for <strong>${escapeHtml(readableDate)}</strong>:</p>
      <ul>${names.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>
      ${
        link
          ? `<p style="margin:24px 0"><a href="${link}/admin/daily" style="background:${BRAND_BLUE};color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Open the team board</a></p>`
          : ""
      }
    </div>`;

  return {
    subject: `DART: ${missing.length} missing for ${businessDate}`,
    text,
    html,
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function summarise(outcomes: SendOutcome[]) {
  return {
    total: outcomes.length,
    sent: outcomes.filter((o) => o.status === "sent").length,
    failed: outcomes.filter((o) => o.status === "failed").length,
    skipped: outcomes.filter((o) => o.status === "skipped").length,
  };
}
