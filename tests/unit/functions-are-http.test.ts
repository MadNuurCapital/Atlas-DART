import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The reminder functions must stay reachable over HTTP.
 *
 * Declaring `export const config = { schedule }` turns a Netlify function into
 * a Scheduled Function, and a Scheduled Function has NO PUBLIC HTTP ENDPOINT
 * in production: Netlify answers /.netlify/functions/<name> with an empty 403
 * at the edge, before the function is reached.
 *
 * All four declared one at launch. The effect was that nothing could ever call
 * them - not the GitHub workflow, not curl, not Netlify's own trigger button -
 * and reminder_logs stayed empty for a month. An empty log looks exactly the
 * same as a schedule that never fires, which is what made it so slow to find.
 *
 * This is asserted against the source text rather than by importing the
 * modules, because the thing being prevented is someone writing that block
 * back into a file. Reading the file is the only way to see it.
 */

const DIR = join(import.meta.dirname, "../../netlify/functions");

const functionFiles = readdirSync(DIR).filter((f) => f.endsWith(".mts"));

describe("the reminder functions are ordinary HTTP functions", () => {
  it("finds the function files, so an empty glob cannot pass silently", () => {
    expect(functionFiles).toEqual(
      expect.arrayContaining([
        "push-reminders.mts",
        "coaching-reminders.mts",
        "reminder-consultants.mts",
        "reminder-admin-digest.mts",
      ]),
    );
  });

  it.each(functionFiles)("%s declares no schedule", (file) => {
    const source = readFileSync(join(DIR, file), "utf8");

    // Comments explain at length why the block is absent, so the check has to
    // look at code rather than at any mention of the words.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    expect(code).not.toMatch(/export\s+const\s+config\b/);
    expect(code).not.toMatch(/\bschedule\s*:/);
  });
});
