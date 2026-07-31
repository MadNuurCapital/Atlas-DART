import { cn } from "@/lib/utils";

/**
 * Achievement against target, as a ring.
 *
 * A ring rather than a bar because this is the one number on the dashboard
 * somebody looks for from across a desk, and a circle carries further than a
 * 2px line. Everything else on the page stays a bar.
 *
 * Drawn with two stroked circles and `stroke-dasharray` - no chart library, no
 * client component, no hydration. It renders on the server and is done.
 */
export function GrRing({
  /** 0-1 and beyond; 1.4 means 140% of target. Null means no target set. */
  ratio,
  label,
  className,
}: {
  ratio: number | null;
  label: string;
  className?: string;
}) {
  // 42 keeps the 100-unit box tidy: r=42 with a stroke of 9 leaves a hair of
  // padding at every edge, so nothing clips when the ring is scaled down.
  const R = 42;
  const CIRCUMFERENCE = 2 * Math.PI * R;

  // Past 100% the ring is full; the number beneath carries the overshoot.
  const shown = ratio === null ? 0 : Math.min(Math.max(ratio, 0), 1);
  const met = ratio !== null && ratio >= 1;

  return (
    <div className={cn("relative aspect-square w-full max-w-[9rem]", className)}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          stroke="var(--secondary)"
          strokeWidth="9"
        />
        {ratio !== null && (
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke={met ? "var(--status-present)" : "var(--primary)"}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - shown)}
            // A zero-length arc still paints a dot with a round cap, which
            // reads as "a little progress" when there is none at all.
            className={shown === 0 ? "hidden" : undefined}
          />
        )}
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {ratio === null ? (
          <span className="px-2 text-center text-xs text-muted-foreground">
            No target set
          </span>
        ) : (
          <>
            <span
              className="text-2xl font-semibold tabular-nums"
              aria-hidden="true"
            >
              {(ratio * 100).toFixed(0)}
              <span className="text-base font-medium text-muted-foreground">
                %
              </span>
            </span>
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              of target
            </span>
            <span className="sr-only">
              {label}: {(ratio * 100).toFixed(1)}% of target
            </span>
          </>
        )}
      </div>
    </div>
  );
}
