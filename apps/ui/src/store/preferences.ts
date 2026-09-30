import { createSignal } from "solid-js";

/** Non-sensitive UI preferences; storage may be unavailable in private browsing. */
export function preference(key: string, fallback: string) {
  let initial = fallback;
  try {
    initial = globalThis.localStorage.getItem(key) ?? fallback;
  } catch {
    /* optional */
  }
  const [value, setValue] = createSignal(initial);
  return [
    value,
    (next: string) => {
      setValue(next);
      try {
        globalThis.localStorage.setItem(key, next);
      } catch {
        /* optional */
      }
    },
  ] as const;
}
