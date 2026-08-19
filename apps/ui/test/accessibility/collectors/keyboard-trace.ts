/**
 * Drives keyboard input as a first-class interaction mechanism and records what moved. This is
 * how keyboard traps, focus loss, and focus escaping into a supposedly-inert background get
 * caught deterministically instead of inferred from a static tree snapshot.
 */
import type { Page } from "playwright/test";
import type { KeyboardTraceEvidence, KeyboardTraceStep, SemanticTarget } from "../evidence-schema";

async function activeElementDescriptor(page: Page): Promise<SemanticTarget | null> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const role =
      el.getAttribute("role") ??
      (el instanceof HTMLButtonElement
        ? "button"
        : el instanceof HTMLAnchorElement
          ? "link"
          : el instanceof HTMLInputElement
            ? "textbox"
            : el.tagName.toLowerCase());
    const name =
      el.getAttribute("aria-label")?.trim() ||
      el.textContent?.trim().slice(0, 80) ||
      el.getAttribute("title")?.trim() ||
      "";
    return { role, name };
  });
}

/**
 * Presses each key in sequence starting from whatever currently has focus, recording the active
 * element before and after each press. `scopeSelector` marks the region focus is expected to stay
 * within (e.g. a dialog root); a step landing outside it is flagged, not silently accepted.
 */
export async function traceKeyboard(
  page: Page,
  browser: "chromium" | "firefox" | "webkit",
  keys: readonly string[],
  scopeSelector: string | null,
): Promise<KeyboardTraceEvidence> {
  const steps: KeyboardTraceStep[] = [];
  for (const key of keys) {
    const activeElementBefore = await activeElementDescriptor(page);
    await page.keyboard.press(key);
    const activeElementAfter = await activeElementDescriptor(page);
    // A key press that legitimately closes the scoped region (e.g. Escape on a dialog) removes
    // the scope element itself — that is not the same failure as focus escaping a trap while the
    // scope is still open, so only flag when the scope element still exists but no longer holds
    // focus. Otherwise every correct "Escape closes the dialog and returns focus to the opener"
    // interaction — outside the scope by design — would misreport as a keyboard trap.
    const scopeStillPresent = scopeSelector
      ? (await page.locator(scopeSelector).count()) > 0
      : false;
    const focusMovedOutsideExpectedScope =
      scopeSelector && scopeStillPresent
        ? !(await page
            .locator(scopeSelector)
            .locator(":focus")
            .count()
            .then((count) => count > 0))
        : false;
    steps.push({ key, activeElementBefore, activeElementAfter, focusMovedOutsideExpectedScope });
  }
  return { source: "keyboard-trace", browser, steps, capturedAt: new Date().toISOString() };
}
