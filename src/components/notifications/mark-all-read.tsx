"use client";

import { useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markAllNotificationsRead } from "@/app/(app)/notifications/actions";

/**
 * Clears the bell.
 *
 * Only rendered when there is something unread, so it never sits there as a
 * button that does nothing. The badge in the header is produced by a server
 * component, which is why the action revalidates the layout as well as this
 * page - otherwise the list would clear and the bell would keep its count.
 */
export function MarkAllRead() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(() => markAllNotificationsRead())}
    >
      {pending ? (
        <Loader2 className="animate-spin" aria-hidden="true" />
      ) : (
        <Check aria-hidden="true" />
      )}
      Mark all read
    </Button>
  );
}
