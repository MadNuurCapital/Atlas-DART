import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { unwrap } = await import("@/lib/query");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("unwrap", () => {
  it("returns the data when the read succeeded", () => {
    expect(unwrap({ data: [1, 2, 3], error: null }, "cases")).toEqual([1, 2, 3]);
  });

  it("passes null through - an absent row is not an error", () => {
    // maybeSingle() legitimately returns null, and a consultant who has not
    // submitted today must still see their dashboard.
    expect(unwrap({ data: null, error: null }, "today's submission")).toBeNull();
  });

  it("throws rather than letting a failed read render as empty", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() =>
      unwrap({ data: null, error: { message: "permission denied" } }, "cases"),
    ).toThrow(/could not read cases/i);
  });

  it("keeps the database's own message out of the thrown error", () => {
    // The page turns this into "something went wrong". The detail belongs in
    // the server log, not on a consultant's screen.
    vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      unwrap(
        { data: null, error: { message: 'relation "secret_table" does not exist' } },
        "cases",
      );
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as Error).message).not.toMatch(/secret_table/);
    }
  });

  it("logs the real reason so it can be diagnosed", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() =>
      unwrap({ data: null, error: { message: "JWT expired" } }, "your target"),
    ).toThrow();

    expect(logged).toHaveBeenCalledWith(
      expect.any(String),
      "your target",
      "JWT expired",
    );
  });
});
