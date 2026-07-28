import { describe, it, expect } from "vitest";
import {
  dailySubmissionSchema,
  appointmentSchema,
  caseSchema,
  cancelCaseSchema,
  insurerSchema,
  sameInsurerName,
  fieldErrors,
} from "@/lib/validation";
import { sgToday, addDays } from "@/lib/sg-date";

const today = sgToday();

const validDaily = {
  businessDate: today,
  dials: 10,
  talkedTo: 4,
  campaignStatus: "running" as const,
  inOffice: true,
  notes: "",
};

describe("daily submission validation", () => {
  it("accepts a normal day", () => {
    expect(dailySubmissionSchema.safeParse(validDaily).success).toBe(true);
  });

  it("accepts a day of zeros", () => {
    const result = dailySubmissionSchema.safeParse({
      ...validDaily,
      dials: 0,
      talkedTo: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a negative count", () => {
    const result = dailySubmissionSchema.safeParse({ ...validDaily, dials: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects a fractional count", () => {
    const result = dailySubmissionSchema.safeParse({
      ...validDaily,
      dials: 3.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a blank required value", () => {
    const result = dailySubmissionSchema.safeParse({
      ...validDaily,
      dials: Number.NaN,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown campaign status", () => {
    const result = dailySubmissionSchema.safeParse({
      ...validDaily,
      campaignStatus: "maybe",
    });
    expect(result.success).toBe(false);
  });

  it("requires the office answer to be a boolean", () => {
    const result = dailySubmissionSchema.safeParse({
      ...validDaily,
      inOffice: "yes",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a date inside the seven-day window", () => {
    const result = dailySubmissionSchema.safeParse({
      ...validDaily,
      businessDate: addDays(today, -7),
    });
    expect(result.success).toBe(true);
  });

  it("rejects a date on day eight", () => {
    const result = dailySubmissionSchema.safeParse({
      ...validDaily,
      businessDate: addDays(today, -8),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrors(result.error).businessDate).toMatch(/last 7 days/i);
    }
  });

  it("rejects a future date", () => {
    const result = dailySubmissionSchema.safeParse({
      ...validDaily,
      businessDate: addDays(today, 1),
    });
    expect(result.success).toBe(false);
  });
});

describe("appointment validation", () => {
  const valid = {
    businessDate: today,
    prospectName: "Ahmad",
    appointmentType: "opening" as const,
    note: "",
  };

  it("accepts a normal appointment", () => {
    expect(appointmentSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a blank prospect name", () => {
    expect(
      appointmentSchema.safeParse({ ...valid, prospectName: "   " }).success,
    ).toBe(false);
  });

  it("trims the prospect name", () => {
    const result = appointmentSchema.safeParse({
      ...valid,
      prospectName: "  Ahmad  ",
    });
    expect(result.success && result.data.prospectName).toBe("Ahmad");
  });

  it("rejects an unknown appointment type", () => {
    expect(
      appointmentSchema.safeParse({ ...valid, appointmentType: "coffee" })
        .success,
    ).toBe(false);
  });
});

describe("case validation", () => {
  const valid = {
    dateSubmitted: "2026-03-10",
    dateIncepted: "2026-04-01",
    clientName: "Siti",
    insurerId: "11111111-1111-4111-8111-111111111111",
    policyName: "Protect Plus",
    policyType: "Term" as const,
    apeAmount: 1200,
    grAmount: 600,
  };

  it("accepts a complete case", () => {
    expect(caseSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts a case that has not incepted yet", () => {
    const result = caseSchema.safeParse({ ...valid, dateIncepted: "" });
    expect(result.success).toBe(true);
  });

  it("accepts zero APE and GR", () => {
    const result = caseSchema.safeParse({
      ...valid,
      apeAmount: 0,
      grAmount: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a negative amount", () => {
    expect(caseSchema.safeParse({ ...valid, grAmount: -1 }).success).toBe(false);
  });

  it("rejects more than two decimal places", () => {
    expect(
      caseSchema.safeParse({ ...valid, grAmount: 10.555 }).success,
    ).toBe(false);
  });

  it("rejects an inception date before the submission date", () => {
    const result = caseSchema.safeParse({
      ...valid,
      dateSubmitted: "2026-03-10",
      dateIncepted: "2026-03-01",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrors(result.error).dateIncepted).toMatch(/cannot incept/i);
    }
  });

  it("rejects a blank client name", () => {
    expect(caseSchema.safeParse({ ...valid, clientName: " " }).success).toBe(
      false,
    );
  });

  it("rejects an unknown policy type", () => {
    expect(
      caseSchema.safeParse({ ...valid, policyType: "Crypto" }).success,
    ).toBe(false);
  });
});

describe("cancellation validation", () => {
  it("requires a meaningful reason", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(cancelCaseSchema.safeParse({ caseId: id, reason: "" }).success).toBe(
      false,
    );
    expect(cancelCaseSchema.safeParse({ caseId: id, reason: "  " }).success).toBe(
      false,
    );
    expect(
      cancelCaseSchema.safeParse({ caseId: id, reason: "Free-look cancelled" })
        .success,
    ).toBe(true);
  });
});

describe("insurer validation", () => {
  it("rejects a one-character name", () => {
    expect(insurerSchema.safeParse({ name: "A" }).success).toBe(false);
  });

  it("trims surrounding whitespace", () => {
    const result = insurerSchema.safeParse({ name: "  AIA Singapore  " });
    expect(result.success && result.data.name).toBe("AIA Singapore");
  });

  describe("matching an existing insurer", () => {
    it("treats case and surrounding space as the same name", () => {
      // Exactly what the unique index on lower(btrim(name)) considers equal.
      expect(sameInsurerName("AIA", "aia")).toBe(true);
      expect(sameInsurerName("  AIA  ", "AIA")).toBe(true);
    });

    it("does not treat a wildcard character as a match", () => {
      // The duplicate lookup uses ilike, where %, _ and * are wildcards. If a
      // loose match were trusted, a case would be filed under an insurer the
      // consultant never chose.
      expect(sameInsurerName("AIAxLife", "AIA_Life")).toBe(false);
      expect(sameInsurerName("AIA Singapore", "AIA%")).toBe(false);
      expect(sameInsurerName("Great Eastern", "Great*")).toBe(false);
    });

    it("keeps genuinely different insurers apart", () => {
      expect(sameInsurerName("AIA", "AIA Singapore")).toBe(false);
      expect(sameInsurerName("Singlife", "Sunlife")).toBe(false);
    });
  });
});

describe("fieldErrors", () => {
  it("returns one message per field", () => {
    const result = dailySubmissionSchema.safeParse({
      ...validDaily,
      dials: -1,
      talkedTo: -5,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = fieldErrors(result.error);
      expect(errors.dials).toBeTruthy();
      expect(errors.talkedTo).toBeTruthy();
    }
  });
});

describe("money precision", () => {
  const base = {
    dateSubmitted: "2026-03-10",
    dateIncepted: "",
    clientName: "Siti",
    insurerId: "11111111-1111-4111-8111-111111111111",
    policyName: "Protect Plus",
    policyType: "Term" as const,
    apeAmount: 1200,
  };

  it("accepts values that are exact in decimal but not in binary", () => {
    // 10.55 * 100 is 1055.0000000000002 in floating point. An exact equality
    // check here would reject a perfectly ordinary premium.
    for (const gr of [10.55, 0.1, 1234.56, 99.99, 0]) {
      expect(caseSchema.safeParse({ ...base, grAmount: gr }).success).toBe(true);
    }
  });

  it("rejects genuine sub-cent precision", () => {
    for (const gr of [10.555, 0.001, 1.2345]) {
      expect(caseSchema.safeParse({ ...base, grAmount: gr }).success).toBe(
        false,
      );
    }
  });
});
