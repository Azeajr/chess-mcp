/**
 * One parameterized dialog scenario: open a dialog, capture browser-tier evidence from whichever
 * collectors this worker supports, attempt AT-tier evidence, and return one bundle. Runs once per
 * browser project; results merge across projects in compute-verdict.
 *
 * Parameterized rather than hardcoded because AG-1's scope is the `Dialog` primitive *and its
 * consumers*, so evidence about one hand-rolled dialog cannot discharge it. The same shape is what
 * AG-3 will need for the move tree.
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

const AT_RUNNERS: readonly AtRunnerId[] = ["nvda", "voiceover"];

export interface DialogScenarioDefinition {
  readonly id: string;
  /** Accessible name of the control that opens the dialog, and the focus-return target. */
  readonly openerName: string;
  readonly dialogName: string;
  /** A control outside the dialog that must be unreachable while it is open. */
  readonly backgroundControlName: string;
  /** Selector for the region focus must stay inside while the dialog is open. */
  readonly scopeSelector: string;
  readonly traceKeys: readonly string[];
}

export interface DialogScenarioOptions {
  readonly runId: string;
  /** Set true to attempt real AT capture when the platform supports it (off in the fast path). */
  readonly attemptAtCapture: boolean;
}

export async function runDialogScenario(
  page: Page,
  browser: "chromium" | "firefox" | "webkit",
  definition: DialogScenarioDefinition,
  options: DialogScenarioOptions,
): Promise<EvidenceBundle> {
  await page.waitForTimeout(500);
  const opener = page.getByRole("button", { name: definition.openerName });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: definition.dialogName });
  await dialog.waitFor({ state: "visible" });

  const ariaSnapshots = [
    await captureAriaSnapshot(dialog, browser, `${definition.dialogName} dialog root`),
  ];
  const cdpAxTrees = supportsCdpAxTree(browser) ? [await captureCdpAxTree(page)] : [];
  const axe = [await captureAxe(page, browser)];

  // AT capture happens here, while the dialog is genuinely open — not after the keyboard trace
  // below, whose last step closes it. A dialog sets its own initial focus asynchronously, which
  // waitFor({ state: "visible" }) does not guarantee has already run, so wait for real DOM focus
  // before asking a screen reader to report it. This check is OS-window-focus-independent.
  if (options.attemptAtCapture) {
    await page.waitForFunction(
      () => document.activeElement !== null && document.activeElement !== document.body,
    );
  }

  const atObservations: EvidenceBundle["atObservations"][number][] = [];
  const infrastructureLimitations: EvidenceBundle["infrastructureLimitations"][number][] = [];
  for (const runner of AT_RUNNERS) {
    if (!options.attemptAtCapture || !currentPlatformSupports(runner)) {
      infrastructureLimitations.push(infrastructureLimitationFor(runner));
      continue;
    }
    // Real capture path — see collectors/at-runner.ts module doc for its verification status.
    const { captureAtObservations } = await import("../collectors/at-runner");
    atObservations.push(
      ...(await captureAtObservations(runner, page, {
        // The screen reader presses the keys; these only wait for the DOM to settle afterwards.
        awaitClosed: async () => {
          await dialog.waitFor({ state: "detached" });
        },
        awaitOpen: async () => {
          await dialog.waitFor({ state: "visible" });
        },
      })),
    );
  }

  const keyboardTraces: KeyboardTraceEvidence[] = [
    await traceKeyboard(page, browser, definition.traceKeys, definition.scopeSelector),
  ];

  return {
    scenarioId: definition.id,
    runId: options.runId,
    stateFingerprint: `${browser}:dialog-open:${definition.dialogName}`,
    ariaSnapshots,
    cdpAxTrees,
    axe,
    keyboardTraces,
    atObservations,
    infrastructureLimitations,
  };
}
