import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A tile.
 *
 * Solid by default, so a GR figure is never read through a blur, but sharing
 * the glass chrome's shadow token so the two sit in one visual system. The
 * large radius is most of what makes a grid of these read as bento rather than
 * as a stack of boxes.
 *
 * Border and background stay ordinary Tailwind utilities rather than a custom
 * shorthand: a caller passing `border-status-late/40` has to be able to win,
 * and a `border:` shorthand declared later in the utilities layer would
 * silently beat it. Callers wanting glass pass `glass` or `glass-strong`,
 * which are declared after Tailwind's utilities and so do override these.
 */
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "rounded-2xl border border-border bg-card text-card-foreground",
        "shadow-[var(--glass-shadow)]",
        // Tiles are grid children as often as not; without this a long name or
        // a wide number stretches its column and breaks the bento rhythm.
        "min-w-0",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex flex-col gap-1.5 p-5", className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="card-title"
      className={cn("font-semibold leading-tight tracking-tight", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card-content" className={cn("p-5 pt-0", className)} {...props} />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center p-5 pt-0", className)}
      {...props}
    />
  );
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
