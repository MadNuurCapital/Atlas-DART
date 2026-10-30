"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

/**
 * A colleague's win, wherever you happen to be in the app.
 *
 * Mounted in the app shell, so the toast arrives on /today, on /cases, on the
 * admin board - anywhere - without that page knowing anything about it.
 *
 * NOT SHOWN TO THE PERSON WHO SUBMITTED IT. They have just closed the
 * congratulations dialog, which names their client, the policy type and what
 * the case did to their month. A second, thinner celebration arriving behind
 * it would read as the app being pleased with itself rather than pleased for
 * them.
 *
 * The filter is on actor_id rather than on anything in the message, because
 * the message is built from the row and the row is the only thing that can be
 * trusted to say who did it.
 */
export function TeamCelebrations({ myId }: { myId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel("team-celebrations")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "team_events" },
        (payload) => {
          const row = payload.new as {
            id: string;
            actor_id: string;
            actor_name: string;
          };

          // Your own case. The dialog already said it better.
          if (row.actor_id === myId) return;

          toast.success(`${row.actor_name} just submitted a case!`, {
            // Keyed by the event id so a redelivered message - which the
            // realtime client will do after a reconnection - replaces the
            // toast rather than stacking a second one beside it.
            id: row.id,
            description: "Another one for the team.",
            duration: 6000,
          });

          // The bell's unread count and the feed below it both live in a
          // server component, so the page has to be told that something
          // changed. Cheap: one round trip, and only when a case is actually
          // submitted rather than on a timer.
          router.refresh();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [myId, router]);

  // Renders nothing. It exists to hold the subscription for as long as the
  // shell is mounted, which is the whole session.
  return null;
}
