import { cn } from "@/lib/utils";

/**
 * Placeholder brand mark.
 *
 * This approximates the Integrated Barakah logo geometry - the orange accent
 * square, the blue outer block and the recessed inner square - using the brand
 * tokens from globals.css. Replace with the supplied asset when it arrives:
 * drop the file in /public and swap the <svg> for an <Image>. Nothing else
 * references these shapes.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      role="img"
      aria-label="Integrated Barakah Wealth Advisory"
      className={cn("h-8 w-8", className)}
    >
      <rect x="0" y="0" width="12" height="12" fill="var(--brand-orange)" />
      <rect x="16" y="0" width="32" height="48" fill="var(--brand-blue)" />
      <rect x="22" y="8" width="20" height="32" fill="var(--background)" />
      <rect x="27" y="16" width="10" height="14" fill="var(--brand-blue-deep)" />
    </svg>
  );
}

export function Logo({
  className,
  showWordmark = true,
}: {
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      {showWordmark && (
        <div className="leading-none">
          <div className="text-sm font-bold tracking-tight text-brand-blue">
            DART &amp; Case Tracker
          </div>
          <div className="mt-0.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Integrated Barakah
          </div>
        </div>
      )}
    </div>
  );
}
