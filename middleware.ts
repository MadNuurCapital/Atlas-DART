import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image optimisation. The session must
     * be refreshed on real page and action requests, not on every icon fetch.
     *
     * sw.js and the manifest are excluded deliberately. The browser re-fetches
     * the service worker on navigation and the manifest on load, and neither
     * carries a session or renders anything - running an auth check on them
     * only added latency to the first paint.
     */
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
