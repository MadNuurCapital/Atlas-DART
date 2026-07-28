import "server-only";

/**
 * Turn a failed read into an error instead of an empty result.
 *
 * PostgREST returns `{ data, error }` rather than throwing, so the natural way
 * to write a page is `const { data } = await supabase.from(...)` followed by
 * `data ?? []`. That reads well and is quietly wrong: a permission problem, a
 * renamed column or a dropped connection then renders a page that looks
 * completely normal and is simply missing everything.
 *
 * On a dashboard that means a consultant who has written S$40,000 of business
 * this month sees S$0 and a target they have apparently missed. They have no
 * way to tell that from the truth, which is worse than any error screen -
 * error boundaries exist precisely so that "something went wrong, try again"
 * is available as an honest answer.
 *
 * Errors are logged with their source before being rethrown, because the
 * message the user sees is deliberately generic.
 */
export function unwrap<T>(
  result: { data: T; error: { message: string } | null },
  source: string,
): T {
  if (result.error) {
    console.error("[query] %s failed: %s", source, result.error.message);
    throw new Error(`Could not read ${source}`);
  }
  return result.data;
}
