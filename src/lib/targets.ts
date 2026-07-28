/**
 * Target and shortfall arithmetic (decisions D4, D8, D17).
 *
 * The yearly target is the number that is actually maintained; the monthly
 * target defaults to yearly / 12 unless an admin has set an explicit override
 * for that month. Shortfall is never negative and nothing here ever divides
 * by zero.
 */

export const MONTHS_PER_YEAR = 12;

/**
 * Resolve the monthly target: an explicit override wins, otherwise the yearly
 * figure spread evenly. Returns null when no target exists at all, which the
 * UI renders as "No target set" rather than as zero.
 */
export function resolveMonthlyTarget(
  monthlyOverride: number | null | undefined,
  yearlyTarget: number | null | undefined,
): number | null {
  if (typeof monthlyOverride === "number" && Number.isFinite(monthlyOverride)) {
    return monthlyOverride;
  }
  if (typeof yearlyTarget === "number" && Number.isFinite(yearlyTarget)) {
    return yearlyTarget / MONTHS_PER_YEAR;
  }
  return null;
}

/** Shortfall clamped at zero - exceeding a target is never a negative gap. */
export function shortfall(
  target: number | null | undefined,
  achieved: number,
): number {
  if (typeof target !== "number" || !Number.isFinite(target)) return 0;
  return Math.max(target - achieved, 0);
}

/**
 * Achievement as a ratio (0.85 = 85%). Null when there is no usable target,
 * so the caller shows "No target set" instead of Infinity or NaN.
 */
export function achievementRatio(
  target: number | null | undefined,
  achieved: number,
): number | null {
  if (typeof target !== "number" || !Number.isFinite(target) || target <= 0) {
    return null;
  }
  return achieved / target;
}

/** Achievement formatted for display, or the explicit no-target message. */
export function formatAchievement(
  target: number | null | undefined,
  achieved: number,
): string {
  const ratio = achievementRatio(target, achieved);
  if (ratio === null) return "No target set";
  return `${(ratio * 100).toFixed(1)}%`;
}

/** Compliance percentage. Zero required days reads as 100%, never NaN. */
export function compliancePercent(
  submittedDays: number,
  requiredDays: number,
): number {
  if (requiredDays <= 0) return 1;
  return Math.min(submittedDays / requiredDays, 1);
}
