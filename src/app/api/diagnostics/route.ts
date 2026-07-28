import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Where is the time actually going?
 *
 * The app is server-rendered, so every page costs one browser-to-server hop
 * plus one server-to-database hop per query. Which of those is slow decides
 * the fix entirely, and guessing at it wastes an afternoon.
 *
 * Admin only, and it reports timings rather than data.
 */
export async function GET() {
  const supabase = await createClient();

  // What the app actually does now. On a project with asymmetric signing keys
  // this is local signature verification and costs almost nothing; the first
  // call may fetch the JWKS, so a second is timed to show the cached cost.
  const claimsStart = Date.now();
  const { data: claims } = await supabase.auth.getClaims();
  const claimsColdMs = Date.now() - claimsStart;

  const userId = claims?.claims?.sub;
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const claimsWarmStart = Date.now();
  await supabase.auth.getClaims();
  const claimsWarmMs = Date.now() - claimsWarmStart;

  // What it used to do, for comparison. Always a network round trip.
  const started = Date.now();
  await supabase.auth.getUser();
  const authMs = Date.now() - started;

  const profileStart = Date.now();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();
  const profileMs = Date.now() - profileStart;

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  // A trivial query - no joins, no scan. Whatever this costs is almost
  // entirely the network round trip between the server and the database.
  const pingStart = Date.now();
  await supabase.rpc("sg_today");
  const pingMs = Date.now() - pingStart;

  // Three in sequence, to show what a page doing several queries pays.
  const serialStart = Date.now();
  await supabase.rpc("sg_today");
  await supabase.rpc("sg_today");
  await supabase.rpc("sg_today");
  const serialMs = Date.now() - serialStart;

  // The same three at once, to show what parallelising is worth.
  const parallelStart = Date.now();
  await Promise.all([
    supabase.rpc("sg_today"),
    supabase.rpc("sg_today"),
    supabase.rpc("sg_today"),
  ]);
  const parallelMs = Date.now() - parallelStart;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseHost = supabaseUrl.replace(/^https?:\/\//, "").split(".")[0];

  const verdict =
    pingMs > 150
      ? "SLOW: the server and the database are far apart. Each query costs a long round trip, and pages run several. Putting them in the same region is the single biggest win available."
      : pingMs > 60
        ? "OK: some distance between server and database, but survivable."
        : "FAST: the server and database are close together. Any remaining lag is the browser-to-server hop or a cold start, not the database.";

  return NextResponse.json(
    {
      verdict,
      auth: {
        // "ES256"/"RS256" means signatures are checked locally - fast.
        // "HS256" means the project is still on the legacy shared secret and
        // every check is a network call; migrating signing keys in the
        // Supabase dashboard would remove a round trip from every page.
        signingAlgorithm: claims?.header?.alg ?? "unknown",
        verifyFirstCallMs: claimsColdMs,
        verifyCachedMs: claimsWarmMs,
        oldGetUserRoundTripMs: authMs,
      },
      timings: {
        profileQueryMs: profileMs,
        singleQueryMs: pingMs,
        threeQueriesSerialMs: serialMs,
        threeQueriesParallelMs: parallelMs,
      },
      where: {
        // Netlify runs functions in one region; the free plan does not let you
        // choose it. The database region is chosen when the project is created.
        serverRegion:
          process.env.AWS_REGION ??
          process.env.NETLIFY_REGION ??
          "unknown (not running on Netlify?)",
        supabaseProject: supabaseHost,
      },
      note: "singleQueryMs is essentially pure network latency between the Netlify function and Supabase. Under ~60ms is healthy; over ~150ms means they are in different parts of the world.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
