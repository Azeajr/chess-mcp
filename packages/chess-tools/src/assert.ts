/** Asserts an internal-construction invariant (e.g. an index or lookup derived from data built a
 *  few lines earlier) that TypeScript can't verify across function/closure boundaries. Not for
 *  revalidating untrusted external input — that belongs in an explicit, message-bearing check. */
export function assertDefined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("assertDefined: expected value to be defined");
  }
  return value;
}
