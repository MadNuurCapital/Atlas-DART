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
     *
     * `.netlify` is excluded because it is not part of this app. It is where
     * the scheduled reminder functions live, and they are called by a machine
     * that has no cookie and never will have one. Without this exclusion the
     * middleware found no session, concluded that
     * /.netlify/functions/push-reminders was a page someone had tried to open
     * while logged out, and bounced it to /login with a 307 - so the reminder
     * functions were unreachable over HTTP from anywhere outside a browser,
     * and had been since launch. They guard themselves with
     * REMINDER_TEST_TOKEN; a login redirect in front of them protected
     * nothing and only ensured nothing could ever call them.
     */
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|\\.netlify|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
