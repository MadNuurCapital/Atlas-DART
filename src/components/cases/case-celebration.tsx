"use client";

import { PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/constants";
import type { CaseCelebration } from "@/app/(app)/cases/actions";

/**
 * Congratulations, on a new case.
 *
 * A signed case is the thing the whole application exists to record, and until
 * now it produced the same small grey toast as changing an insurer's name. An
 * advisor who has just closed business deserves the app to notice.
 *
 * Shown only on a CREATE. Editing a case is bookkeeping and celebrating it
 * would cheapen the real thing - the fifth congratulations for correcting one
 * typo is worse than no congratulations at all.
 *
 * The month total comes from the database after the insert rather than from
 * adding this case to a number the page was already holding, so it is right
 * even when something was cancelled in another tab.
 */
export function CaseCelebrationDialog({
  celebration,
  onClose,
}: {
  celebration: CaseCelebration | null;
  onClose: () => void;
}) {
  const c = celebration;

  return (
    <Dialog open={c !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        {c && (
          <>
            <DialogHeader className="items-center text-center">
              <span
                aria-hidden="true"
                className="mb-1 flex size-14 items-center justify-center rounded-2xl bg-status-present/12"
              >
                <PartyPopper className="size-7 text-status-present" />
              </span>
              <DialogTitle className="text-xl">
                Congratulations on your case submission
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {c.clientName}
                </span>{" "}
                · {c.policyType}
              </p>

              <div className="rounded-2xl bg-secondary/70 px-4 py-4">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  GR from this case
                </p>
                <p className="mt-1 text-3xl font-semibold tabular-nums text-status-present">
                  {formatCurrency(c.grAmount)}
                </p>
              </div>

              <p className="text-sm text-muted-foreground">
                That takes your {c.monthLabel} GR to{" "}
                <span className="font-semibold tabular-nums text-foreground">
                  {formatCurrency(c.monthToDateGr)}
                </span>
                .
              </p>
            </div>

            <Button type="button" onClick={onClose} className="mt-2 w-full">
              Thanks
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
