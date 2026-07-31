import { cn } from "@/lib/utils";

/**
 * The Atlas mark.
 *
 * Rebuilt as geometry rather than shipped as an image, for three reasons: it
 * stays sharp at every size from a 16px favicon to a 512px app icon, it has no
 * white box behind it on the dark theme, and the halo is a CSS drop-shadow that
 * follows the silhouette and changes with the theme rather than being baked in.
 *
 * The composition is a spiral: a detached gold square at the top left, blue
 * bars wrapping clockwise around an open centre, and a small blue square
 * floating in the middle. Coordinates are measured from the supplied artwork,
 * normalised to a 48x48 box.
 */
export function LogoMark({
  className,
  glow = false,
}: {
  className?: string;
  /** Soft brand-coloured halo. For the login screen, not for a 20px header. */
  glow?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      role="img"
      aria-label="Atlas DART"
      className={cn("h-8 w-8 shrink-0", glow && "logo-glow", className)}
    >
      {/* The accent, detached at the top left. */}
      <rect x="0" y="0" width="11" height="11" rx="1" fill="var(--brand-gold)" />

      {/* The spiral, wrapping clockwise from the gap beside the accent. */}
      <g fill="var(--logo-blue)">
        <rect x="17.5" y="0" width="30.5" height="11" rx="1.5" />
        <rect x="37" y="0" width="11" height="48" rx="1.5" />
        <rect x="0" y="37" width="48" height="11" rx="1.5" />
        <rect x="0" y="17.5" width="11" height="30.5" rx="1.5" />
      </g>

      {/* The centre, floating free of the spiral. */}
      <rect
        x="19.5"
        y="20.5"
        width="9.5"
        height="10"
        rx="1"
        fill="var(--logo-blue)"
      />
    </svg>
  );
}

/**
 * Mark plus wordmark.
 *
 * ATLAS carries the weight; DART sits beneath it in the same blue at a smaller
 * size, matching the supplied lockup's roughly 3.6:1 proportions.
 */
export function Logo({
  className,
  showWordmark = true,
  glow = false,
}: {
  className?: string;
  showWordmark?: boolean;
  glow?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <LogoMark glow={glow} />
      {showWordmark && (
        <div className="leading-none">
          <div className="text-lg font-bold uppercase tracking-[0.14em] text-[var(--logo-blue)]">
            Atlas
          </div>
          <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.34em] text-[var(--logo-blue)]/75">
            Dart
          </div>
        </div>
      )}
    </div>
  );
}

/** The full name, for places that need words rather than artwork. */
export const APP_NAME = "Atlas DART";
export const APP_TAGLINE = "Advisor Tracking, Learning & Assistance System";
