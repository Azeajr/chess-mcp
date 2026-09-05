export function assertDefined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("assertDefined: expected value to be defined");
  }
  return value;
}
