import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * The service-role key bypasses Row Level Security completely. If it ever
 * reached the browser, every policy in 0011_rls.sql would be irrelevant.
 *
 * `import "server-only"` in lib/supabase/admin.ts already turns a client-side
 * import into a build error. These tests are the belt to that pair of braces,
 * and they fail fast at unit-test time rather than at build time.
 */
describe("the service-role key cannot reach the browser", () => {
  const sourceFiles = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f));

  it("has no client component importing the admin client", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles) {
      const content = readFileSync(file, "utf8");
      const isClientComponent = /^\s*["']use client["']/m.test(content);
      const importsAdmin =
        /from\s+["']@\/lib\/supabase\/admin["']/.test(content) ||
        /createAdminClient/.test(content);

      if (isClientComponent && importsAdmin) {
        offenders.push(relative(ROOT, file));
      }
    }

    expect(offenders).toEqual([]);
  });

  it("never references the secret key outside server-only modules", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles) {
      const content = readFileSync(file, "utf8");
      if (!content.includes("SUPABASE_SECRET_KEY")) continue;

      const rel = relative(ROOT, file);
      // The single legitimate reader is the admin client, which is server-only.
      if (rel === join("src", "lib", "supabase", "admin.ts")) continue;
      offenders.push(rel);
    }

    expect(offenders).toEqual([]);
  });

  it("keeps the secret out of any built client bundle", () => {
    const staticDir = join(ROOT, ".next", "static");
    if (!existsSync(staticDir)) {
      // Nothing built yet - the two checks above still stand on their own.
      return;
    }

    const leaked = walk(staticDir)
      .filter((f) => f.endsWith(".js"))
      .filter((f) => {
        const content = readFileSync(f, "utf8");
        return (
          content.includes("SUPABASE_SECRET_KEY") || content.includes("sb_secret_")
        );
      })
      .map((f) => relative(ROOT, f));

    expect(leaked).toEqual([]);
  });
});

describe("server-only boundaries are declared", () => {
  it("marks every privileged module as server-only", () => {
    const mustBeServerOnly = [
      join(SRC, "lib", "supabase", "admin.ts"),
      join(SRC, "lib", "supabase", "server.ts"),
      join(SRC, "lib", "auth.ts"),
    ];

    for (const file of mustBeServerOnly) {
      const content = readFileSync(file, "utf8");
      expect(
        /import\s+["']server-only["']/.test(content),
        `${relative(ROOT, file)} must import "server-only"`,
      ).toBe(true);
    }
  });
});
