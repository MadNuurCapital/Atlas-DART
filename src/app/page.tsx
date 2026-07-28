import { redirect } from "next/navigation";

/**
 * The root has no content of its own. Middleware has already established
 * whether there is a session, so this either lands on the dashboard or is
 * bounced to login on the way.
 */
export default function RootPage() {
  redirect("/dashboard");
}
