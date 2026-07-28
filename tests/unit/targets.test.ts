import { describe, it, expect } from "vitest";
import {
  resolveMonthlyTarget,
  shortfall,
  achievementRatio,
  formatAchievement,
  compliancePercent,
} from "@/lib/targets";
import { formatCurrency } from "@/lib/constants";

describe("monthly target resolution (decision D17)", () => {
  it("divides the yearly target by twelve", () => {
    expect(resolveMonthlyTarget(null, 120000)).toBe(10000);
  });

  it("prefers an explicit monthly override", () => {
    expect(resolveMonthlyTarget(4000, 120000)).toBe(4000);
  });

  it("allows an override of zero", () => {
    // A deliberate zero for a quiet month is not the same as "no target".
    expect(resolveMonthlyTarget(0, 120000)).toBe(0);
  });

  it("returns null when nothing is set", () => {
    expect(resolveMonthlyTarget(null, null)).toBeNull();
    expect(resolveMonthlyTarget(undefined, undefined)).toBeNull();
  });
});

describe("shortfall", () => {
  it("reports the gap to the target", () => {
    expect(shortfall(10000, 4000)).toBe(6000);
  });

  it("is never negative when the target is exceeded", () => {
    expect(shortfall(10000, 25000)).toBe(0);
  });

  it("is zero when there is no target", () => {
    expect(shortfall(null, 5000)).toBe(0);
    expect(shortfall(undefined, 5000)).toBe(0);
  });
});

describe("achievement", () => {
  it("returns a ratio", () => {
    expect(achievementRatio(10000, 8500)).toBeCloseTo(0.85);
  });

  it("exceeds one when the target is beaten", () => {
    expect(achievementRatio(10000, 12000)).toBeCloseTo(1.2);
  });

  it("never divides by zero", () => {
    expect(achievementRatio(0, 5000)).toBeNull();
    expect(achievementRatio(null, 5000)).toBeNull();
    expect(Number.isFinite(achievementRatio(0, 5000) ?? 0)).toBe(true);
  });

  it("says so plainly when no target is set", () => {
    expect(formatAchievement(null, 5000)).toBe("No target set");
    expect(formatAchievement(0, 5000)).toBe("No target set");
    expect(formatAchievement(10000, 8500)).toBe("85.0%");
  });
});

describe("compliance percentage (decision D7)", () => {
  it("is a full mark when every required day was submitted", () => {
    expect(compliancePercent(12, 12)).toBe(1);
  });

  it("is proportional when days are missing", () => {
    expect(compliancePercent(6, 12)).toBe(0.5);
  });

  it("does not divide by zero for a future month", () => {
    expect(compliancePercent(0, 0)).toBe(1);
  });

  it("never exceeds one", () => {
    expect(compliancePercent(15, 12)).toBe(1);
  });
});

describe("currency formatting", () => {
  it("formats Singapore dollars", () => {
    expect(formatCurrency(120000)).toMatch(/120,000\.00/);
  });

  it("treats null and NaN as zero rather than crashing", () => {
    expect(formatCurrency(null)).toMatch(/0\.00/);
    expect(formatCurrency(Number.NaN)).toMatch(/0\.00/);
  });
});
