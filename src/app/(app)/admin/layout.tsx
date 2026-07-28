import { requireAdmin } from "@/lib/auth";

/**
 * Second gate on the admin area.
 *
 * Middleware already redirects non-admins away from /admin, and Row Level
 * Security means an admin page would return nothing useful to a consultant
 * anyway. This layer exists so that none of those three has to be perfect on
 * its own.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();
  return <>{children}</>;
}
