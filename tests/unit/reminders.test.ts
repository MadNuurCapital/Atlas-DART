import { describe, it, expect } from "vitest";
import {
  sgToday,
  formatSgDate,
  consultantEmail,
  adminDigestEmail,
  escapeHtml,
  summarise,
  authoriseManualRun,
  authoriseRun,
  type MissingPerson,
} from "../../netlify/functions/lib/reminders.mts";

const person = (name: string): MissingPerson => ({
  user_id: crypto.randomUUID(),
  full_name: name,
  email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.test`,
  role: "consultant",
});

describe("the reminder decides its own Singapore date", () => {
  it("does not inherit the runtime timezone", () => {
    // The consultant nudge fires at 13:00 UTC, which is 21:00 in Singapore on
    // the SAME day. Getting this wrong would chase people about yesterday.
    expect(sgToday(new Date("2026-03-10T13:00:00Z"))).toBe("2026-03-10");
  });

  it("still reads as the same day at the 15:59 UTC digest", () => {
    // 15:59 UTC is 23:59 Singapore - the deadline, one minute before rollover.
    expect(sgToday(new Date("2026-03-10T15:59:00Z"))).toBe("2026-03-10");
  });

  it("rolls over at 16:00 UTC, which is Singapore midnight", () => {
    expect(sgToday(new Date("2026-03-10T15:59:59Z"))).toBe("2026-03-10");
    expect(sgToday(new Date("2026-03-10T16:00:00Z"))).toBe("2026-03-11");
  });

  it("formats a date readably in Singapore", () => {
    expect(formatSgDate("2026-03-10")).toMatch(/10 March 2026/);
  });
});

describe("consultant reminder", () => {
  it("uses the subject line the specification asks for", () => {
    expect(consultantEmail("Ahmad bin Ismail", "2026-03-10").subject).toBe(
      "Daily DART Update Missing",
    );
  });

  it("opens with the agreed greeting and the person's first name", () => {
    const mail = consultantEmail("Ahmad bin Ismail", "2026-03-10");
    expect(mail.text).toMatch(/^Assalamualaikum Ahmad,/);
    expect(mail.text).not.toContain("bin Ismail,");
  });

  it("names the date and says what is missing", () => {
    const mail = consultantEmail("Siti", "2026-03-10");
    expect(mail.text).toContain("10 March 2026");
    expect(mail.text).toMatch(/has not been submitted yet/);
  });

  it("copes with a single-word name", () => {
    expect(consultantEmail("Siti", "2026-03-10").text).toMatch(
      /^Assalamualaikum Siti,/,
    );
  });
});

describe("admin digest", () => {
  it("lists everyone missing and counts them in the subject", () => {
    const mail = adminDigestEmail(
      [person("Ahmad Ismail"), person("Siti Nurhaliza")],
      "2026-03-10",
    );
    expect(mail.subject).toBe("DART: 2 missing for 2026-03-10");
    expect(mail.text).toContain("Ahmad Ismail");
    expect(mail.text).toContain("Siti Nurhaliza");
  });

  it("uses the singular for one person", () => {
    const mail = adminDigestEmail([person("Ahmad")], "2026-03-10");
    expect(mail.text).toMatch(/1 person has not submitted/);
  });

  it("still reports when nobody is missing", () => {
    // "Everyone submitted" is information an admin wants at the end of a day.
    const mail = adminDigestEmail([], "2026-03-10");
    expect(mail.subject).toMatch(/all submitted/);
    expect(mail.text).toMatch(/Everyone submitted/);
  });
});

describe("html escaping", () => {
  it("neutralises markup in a name", () => {
    // Names come from the database, but a name is still untrusted input.
    const mail = adminDigestEmail(
      [person("Ahmad <script>alert(1)</script>")],
      "2026-03-10",
    );
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });

  it("escapes the five characters that matter", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});

describe("manual run authorisation", () => {
  const withToken = (token: string | undefined, url: string, header?: string) => {
    const previous = process.env.REMINDER_TEST_TOKEN;
    if (token === undefined) delete process.env.REMINDER_TEST_TOKEN;
    else process.env.REMINDER_TEST_TOKEN = token;

    const request = new Request(url, {
      headers: header ? { authorization: header } : {},
    });
    const result = authoriseManualRun(request);

    if (previous === undefined) delete process.env.REMINDER_TEST_TOKEN;
    else process.env.REMINDER_TEST_TOKEN = previous;
    return result;
  };

  it("accepts a matching bearer token", () => {
    expect(
      withToken("s3cret", "https://x.test/f", "Bearer s3cret"),
    ).toBe(true);
  });

  it("accepts a matching query token", () => {
    expect(withToken("s3cret", "https://x.test/f?token=s3cret")).toBe(true);
  });

  it("rejects a wrong token", () => {
    expect(withToken("s3cret", "https://x.test/f?token=nope")).toBe(false);
  });

  it("rejects everything when no token is configured", () => {
    // Fail closed. An unguarded endpoint that emails the whole team is not
    // something to leave open because an env var was forgotten.
    expect(withToken(undefined, "https://x.test/f?token=anything")).toBe(false);
  });
});

describe("the gate every reminder function goes through", () => {
  const guard = (url: string, header?: string) => {
    const previous = process.env.REMINDER_TEST_TOKEN;
    process.env.REMINDER_TEST_TOKEN = "s3cret";

    const request = new Request(url, {
      headers: header ? { authorization: header } : {},
    });
    const result = authoriseRun(request);

    if (previous === undefined) delete process.env.REMINDER_TEST_TOKEN;
    else process.env.REMINDER_TEST_TOKEN = previous;
    return result;
  };

  it("lets a correct bearer token through", () => {
    expect(guard("https://x.test/f", "Bearer s3cret")).toBe(true);
  });

  /**
   * The regression this file exists for.
   *
   * The guard used to read `if (!scheduled && !authoriseManualRun(request))`,
   * where `scheduled` was true whenever the URL carried a `?scheduled`
   * parameter. That is not a fact about the caller, it is a fact about the
   * string the caller typed - so anyone at all could type it and get an
   * unauthenticated run of the sender against the live team.
   */
  it("is not opened by ?scheduled, which anyone can type", () => {
    expect(guard("https://x.test/f?scheduled")).toBe(false);
    expect(guard("https://x.test/f?scheduled=true")).toBe(false);
    expect(guard("https://x.test/f?scheduled&dryRun=false")).toBe(false);
  });

  it("is not opened by ?scheduled alongside a wrong token", () => {
    expect(guard("https://x.test/f?scheduled&token=nope")).toBe(false);
    expect(guard("https://x.test/f?scheduled", "Bearer nope")).toBe(false);
  });

  it("turns nobody away who presents the token, parameters or not", () => {
    expect(guard("https://x.test/f?scheduled&dryRun=true", "Bearer s3cret")).toBe(
      true,
    );
  });
});

describe("run summary", () => {
  it("counts each outcome", () => {
    expect(
      summarise([
        { userId: "1", email: "a", status: "sent" },
        { userId: "2", email: "b", status: "sent" },
        { userId: "3", email: "c", status: "failed", error: "boom" },
        { userId: "4", email: "d", status: "skipped" },
      ]),
    ).toEqual({ total: 4, sent: 2, failed: 1, skipped: 1 });
  });
});
