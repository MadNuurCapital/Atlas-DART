import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

/**
 * Routes reachable without a session.
 *
 * /auth/callback must be public: it is where an emailed invitation lands, and
 * at that moment the visitor has no session yet - establishing one is the
 * entire job of that page.
 */
const PUBLIC_PATHS = ["/login", "/auth"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/**
 * Refreshes the Supabase session on every request and gates access.
 *
 * This is a convenience layer that keeps unauthenticated users out of the UI
 * and gives a clean redirect. It is NOT the security boundary - Row Level
 * Security in Postgres is. Every admin server action re-checks the role.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getClaims() verifies the access token's signature - locally via WebCrypto
  // where the project uses asymmetric signing keys, otherwise by asking the
  // Auth server exactly as getUser() would. Local verification is the point:
  // middleware runs ahead of every navigation, every server action and every
  // prefetch, so a network round trip here is paid before the page has begun.
  //
  // It still refreshes an access token that is close to expiring, which is
  // the other half of what this middleware exists to do.
  //
  // Do not swap this for getSession(), which trusts a cookie unverified.
  const { data: claimsData } = await supabase.auth.getClaims();
  const user = claimsData?.claims?.sub ? claimsData.claims : null;

  const { pathname } = request.nextUrl;

  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // The admin role is deliberately NOT checked here.
  //
  // It used to be, which meant every /admin request paid for an extra profiles
  // SELECT before the page even started rendering - and then the admin layout
  // looked the role up again anyway. The check now happens once, in
  // requireAdmin(), where the answer is already cached for the rest of the
  // render.
  //
  // Nothing is weaker for it. A consultant who reaches /admin is redirected by
  // the layout instead of by middleware, and Row Level Security means the page
  // could not have shown them anything either way.

  return response;
}
