// This route reads VAPID_PRIVATE_KEY to check the key pair matches. A route
// handler never ships to the browser anyway, but the declaration is what turns
// a careless client import into a build error rather than a published secret -
// and it is what the leak test looks for, which is how this line came to exist.
import "server-only";

import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Are the two VAPID keys actually a pair?
 *
 * This is the question nobody can answer by looking. The private key is a
 * P-256 scalar and the public key is the point it generates, so the public one
 * can be derived from the private one and compared. If they disagree, every
 * notification fails at the moment of sending - the browser subscribed with
 * one key and the server signs with another.
 *
 * Reports booleans and, at most, the first characters of the PUBLIC key. The
 * private key is never returned, logged, or included in any error.
 */
function vapidStatus() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();

  if (!publicKey || !privateKey) {
    return {
      publicKeySet: Boolean(publicKey),
      privateKeySet: Boolean(privateKey),
      verdict:
        "STOP - a VAPID key is missing, so the sender throws before it can send or log anything. Set both in Netlify, then redeploy.",
    };
  }

  const publicBytes = Buffer.from(publicKey, "base64url").length;
  const privateBytes = Buffer.from(privateKey, "base64url").length;

  let derived: string | null = null;
  let deriveError: string | null = null;
  try {
    const ecdh = crypto.createECDH("prime256v1");
    ecdh.setPrivateKey(Buffer.from(privateKey, "base64url"));
    derived = ecdh.getPublicKey().toString("base64url");
  } catch (error) {
    deriveError = error instanceof Error ? error.message : String(error);
  }

  const matches = derived !== null && derived === publicKey;

  return {
    publicKeySet: true,
    privateKeySet: true,
    // 65 and 32 are the only correct answers for P-256. Anything else means a
    // truncated or mangled paste, which throws on the sender's first line.
    publicKeyBytes: publicBytes,
    privateKeyBytes: privateBytes,
    publicKeyStartsWith: publicKey.slice(0, 12),
    pairMatches: matches,
    verdict: deriveError
      ? `STOP - the private key is not a valid P-256 key (${deriveError}). Regenerate BOTH keys as a pair.`
      : matches
        ? publicBytes === 65 && privateBytes === 32
          ? "OK - the two keys are a genuine pair and correctly shaped."
          : "OK as a pair, but one is the wrong length. Regenerate both."
        : "STOP - the keys are NOT a pair. The browser subscribes with the public one and the server signs with the private one; every send will fail. Regenerate BOTH together and redeploy.",
  };
}

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
      // Why notifications are or are not going out. Needs no token: an admin
      // session is enough, which matters because the token-guarded manual
      // trigger is unusable if REMINDER_TEST_TOKEN is itself unset.
      push: {
        ...vapidStatus(),
        reminderTestTokenSet: Boolean(process.env.REMINDER_TEST_TOKEN),
        appUrlSet: Boolean(process.env.APP_URL),
        appUrl: process.env.APP_URL ?? "(not set)",
      },
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
