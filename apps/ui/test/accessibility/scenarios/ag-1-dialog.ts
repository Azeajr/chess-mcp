/**
 * The AG-1 proof of concept: open the Strategic Fit dialog, capture browser-tier evidence from
 * whichever collectors this worker supports, attempt AT-tier evidence, and return one bundle.
 * Called once per browser project; results merge across projects in the spec.
 */
import type { Page } from "playwright/test";
import type { EvidenceBundle, KeyboardTraceEvidence } from "../evidence-schema";
import { captureAriaSnapshot, captureCdpAxTree, supportsCdpAxTree } from "../collectors/browser-ax";
import { captureAxe } from "../collectors/axe";
import { traceKeyboard } from "../collectors/keyboard-trace";
import {
  currentPlatformSupports,
  infrastructureLimitationFor,
  type AtRunnerId,
} from "../collectors/at-runner";

export const AG1_SCENARIO_ID = "ag-1-strategic-fit-dialog";
export const AG1_OPENER_NAME = "Open Strategic Fit";
export const AG1_DIALOG_NAME = "Strategic Fit";
export const AG1_BACKGROUND_CONTROL_NAME = "Open PGN";

const AT_RUNNERS: readonly AtRunnerId[] = ["nvda", "voiceover"];

export interface RunAg1ScenarioOptions {
  readonly runId: string;
  /** Set true to attempt real AT capture when the platform supports it (off in the fast path). */
  readonly attemptAtCapture: boolean;
}

export async function runAg1Scenario(
  page: Page,
  browser: "chromium" | "firefox" | "webkit",
  options: RunAg1ScenarioOptions,
): Promise<EvidenceBundle> {
  await page.waitForTimeout(500);
  const opener = page.getByRole("button", { name: AG1_OPENER_NAME });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: AG1_DIALOG_NAME });
  await dialog.waitFor({ state: "visible" });

  const ariaSnapshots = [await captureAriaSnapshot(dialog, browser, "Strategic Fit dialog root")];

  const cdpAxTrees = supportsCdpAxTree(browser) ? [await captureCdpAxTree(page)] : [];

  const axe = [await captureAxe(page, browser)];

  // AT capture must happen here, while the dialog is genuinely open — not after the keyboard
  // trace below, whose last step presses Escape and closes it (run 32206750401's real VoiceOver
  // observation named neither the dialog nor any page content, because by the old ordering the
  // dialog was already closed by the time it ran).
  //
  // Runs 32206750401/32207555004 also tried forcing focus with a raw click on the dialog's
  // heading. That was worse, not better: a click on a non-focusable element blurs whatever was
  // previously focused without focusing the click target, which likely wiped out the Dialog
  // primitive's own initial-focus behavior (Dialog.tsx's onMount, requestAnimationFrame) rather
  // than helping it. Removed. The AT commands themselves changed instead — see
  // collectors/at-runner.ts — to ones that report real DOM focus rather than an AT-internal
  // cursor position, so they should correctly observe whatever the Dialog primitive already
  // focuses on its own, with no synthetic click needed.
  //
  // What remains here: since that initial focus is set inside a requestAnimationFrame callback,
  // dialog.waitFor({ state: "visible" }) above is not guaranteed to happen after it has run —
  // wait explicitly for real DOM focus to land inside the dialog before asking the AT to report it.
  if (options.attemptAtCapture) {
    await page.waitForFunction(
      () => document.activeElement !== null && document.activeElement !== document.body,
    );
  }

  const atObservations: EvidenceBundle["atObservations"][number][] = [];
  const infrastructureLimitations: EvidenceBundle["infrastructureLimitations"][number][] = [];
  if (options.attemptAtCapture) {
    for (const runner of AT_RUNNERS) {
      if (!currentPlatformSupports(runner)) {
        infrastructureLimitations.push(infrastructureLimitationFor(runner));
        continue;
      }
      // Real capture path — see collectors/at-runner.ts module doc for its verification status.
      const { captureAtObservation } = await import("../collectors/at-runner");
      atObservations.push(await captureAtObservation(runner));
    }
  } else {
    for (const runner of AT_RUNNERS)
      infrastructureLimitations.push(infrastructureLimitationFor(runner));
  }

  const keyboardTraces: KeyboardTraceEvidence[] = [
    await traceKeyboard(
      page,
      browser,
      ["Tab", "Tab", "Tab", "Shift+Tab", "Escape"],
      ".strategic-fit-workspace, [role='dialog']",
    ),
  ];

  return {
    scenarioId: AG1_SCENARIO_ID,
    runId: options.runId,
    stateFingerprint: `${browser}:dialog-open:${AG1_DIALOG_NAME}`,
    ariaSnapshots,
    cdpAxTrees,
    axe,
    keyboardTraces,
    atObservations,
    infrastructureLimitations,
  };
}

/** Merge per-browser bundles from the same scenario run into the one the verdict engine reads. */
export function mergeBundles(bundles: readonly EvidenceBundle[]): EvidenceBundle {
  const [first] = bundles;
  if (!first) throw new Error("mergeBundles requires at least one bundle.");
  return {
    scenarioId: first.scenarioId,
    runId: first.runId,
    stateFingerprint: bundles.map((bundle) => bundle.stateFingerprint).join("|"),
    ariaSnapshots: bundles.flatMap((bundle) => bundle.ariaSnapshots),
    cdpAxTrees: bundles.flatMap((bundle) => bundle.cdpAxTrees),
    axe: bundles.flatMap((bundle) => bundle.axe),
    keyboardTraces: bundles.flatMap((bundle) => bundle.keyboardTraces),
    atObservations: bundles.flatMap((bundle) => bundle.atObservations),
    infrastructureLimitations: dedupeLimitations(
      bundles.flatMap((bundle) => bundle.infrastructureLimitations),
    ),
  };
}

function dedupeLimitations(
  limitations: readonly EvidenceBundle["infrastructureLimitations"][number][],
): EvidenceBundle["infrastructureLimitations"] {
  const seen = new Set<string>();
  return limitations.filter((limitation) => {
    if (seen.has(limitation.runner)) return false;
    seen.add(limitation.runner);
    return true;
  });
}
