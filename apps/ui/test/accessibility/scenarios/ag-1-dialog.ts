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

  const keyboardTraces: KeyboardTraceEvidence[] = [
    await traceKeyboard(
      page,
      browser,
      ["Tab", "Tab", "Tab", "Shift+Tab", "Escape"],
      ".strategic-fit-workspace, [role='dialog']",
    ),
  ];

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
      atObservations.push(
        await captureAtObservation(runner, {
          // "moveToNext" (NVDA) confirmed valid by CI run 32205714869 actually executing it.
          // "next" (invented from a screenReader.next() method-call example, not a real
          // keyboardCommands key) failed that same run with "Unknown voiceover keyboard command:
          // next" — findNextControl is the one VoiceOver key confirmed real from
          // github.com/guidepup/guidepup's own "Complex Navigation" example, not yet re-verified
          // by an actual run.
          commands: runner === "nvda" ? ["moveToNext"] : ["findNextControl"],
        }),
      );
    }
  } else {
    for (const runner of AT_RUNNERS)
      infrastructureLimitations.push(infrastructureLimitationFor(runner));
  }

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
