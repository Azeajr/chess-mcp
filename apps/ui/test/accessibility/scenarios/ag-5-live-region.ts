/**
 * AG-5's concrete scenario: the app-root live-region announcement policy. The browser tier
 * captures the two regions' ARIA semantics; the AT tier drives each policy operation through
 * `window.__chess.exerciseAnnouncementScenario` with a real screen reader live and slices its
 * utterance log per operation — exactly one complete expected message, no progress-tick speech,
 * no truncation, and no overlap with the next message.
 */
import type { Page } from "playwright/test";
import type { AtObservation, EvidenceBundle } from "../evidence-schema";
import { captureAriaSnapshot, captureCdpAxTree, supportsCdpAxTree } from "../collectors/browser-ax";
import { collectAtTier } from "../collectors/at-tier";

export const AG5_SCENARIO_ID = "ag-5-live-region";

/** One policy operation, expressed as a scenario id plus the tokens a real utterance must carry. */
export interface AnnouncementScenarioExpectation {
  readonly scenario: string;
  /** Every token must appear across the operation's utterances (case-insensitive). */
  readonly requiredTokens: readonly string[];
  /** Utterances that must NOT appear — progress ticks and streaming tokens name these. */
  readonly forbiddenTokens: readonly string[];
  readonly maxUtterances: number;
}

export const ANNOUNCEMENT_SCENARIOS: readonly AnnouncementScenarioExpectation[] = [
  {
    scenario: "document-restored",
    requiredTokens: ["restored", "autosave"],
    forbiddenTokens: [],
    maxUtterances: 4,
  },
  {
    scenario: "operation-started",
    requiredTokens: ["audit", "started"],
    forbiddenTokens: ["progress"],
    maxUtterances: 4,
  },
  {
    scenario: "operation-completed",
    requiredTokens: ["audit", "completed"],
    forbiddenTokens: ["progress"],
    maxUtterances: 4,
  },
  {
    scenario: "operation-cancelled",
    requiredTokens: ["cancelled"],
    forbiddenTokens: [],
    maxUtterances: 4,
  },
  {
    scenario: "operation-failed",
    requiredTokens: ["failed"],
    forbiddenTokens: [],
    maxUtterances: 5,
  },
];

export async function runLiveRegionScenario(
  page: Page,
  browser: "chromium" | "firefox" | "webkit",
  runId: string,
  attemptAtCapture: boolean,
): Promise<EvidenceBundle> {
  // The polite region is the assertion surface for browser-tier evidence.
  const politeRegion = page.locator("[data-app-live-region='polite']");
  await politeRegion.waitFor({ state: "attached" });

  // Both regions are empty until a message lands (Show renders nothing), so a snapshot taken now
  // would prove nothing about live-region semantics. Fire one real operation first — its start
  // announcement fills the polite region, its failure fills the assertive one with role="alert" —
  // so the browser-tier snapshot below observes real, present content rather than an empty
  // container. This exercise is independent of the AT-tier loop below: by the time it re-triggers
  // "operation-failed" the 500 ms de-duplication window has long elapsed, so it re-announces.
  await page.evaluate(() => {
    const chess = (
      window as unknown as { __chess: { exerciseAnnouncementScenario(s: string): Promise<void> } }
    ).__chess;
    return chess.exerciseAnnouncementScenario("operation-failed");
  });
  await page.waitForTimeout(300);

  const ariaSnapshots = [
    await captureAriaSnapshot(page.locator(".app-live-regions"), browser, "app live regions root"),
  ];
  const cdpAxTrees = supportsCdpAxTree(browser) ? [await captureCdpAxTree(page)] : [];

  const { atObservations, infrastructureLimitations } = await collectAtTier({
    attemptAtCapture,
    label: AG5_SCENARIO_ID,
    capture: async (runner) => {
      const { withScreenReader } = await import("../collectors/at-runner");
      return withScreenReader(runner, page, async (session) => {
        await session.focusBrowser();
        await session.since(); // discard startup chatter

        const observations: AtObservation[] = [];
        for (const expectation of ANNOUNCEMENT_SCENARIOS) {
          await session.focusBrowser();
          await session.since(); // drain stale state before the operation
          // The live-region update is triggered by page.evaluate — an external (Playwright)
          // action, not a screen-reader-driven press/perform — so since()'s spokenPhraseLog
          // diffing cannot see its speech at all (see withScreenReader's top comment). Guidepup's
          // own capture() exists for exactly this: it records speech spoken during an
          // externally-driven action.
          // The trailing wait is INSIDE the captured action on purpose: the DOM update ->
          // OS-accessibility-notification -> speech-synthesis pipeline has real latency after
          // the app promise resolves, and capture() only records speech while its action is in
          // flight (same constraint as since(), see withScreenReader's top comment). Run
          // 32675591143 confirmed the pipeline works but came back with a mix of empty and
          // bled-together utterances — consistent with the window closing before trailing speech
          // settled, not with the mechanism itself being wrong.
          const { spokenPhrase } = await session.captureExternalAction(async () => {
            await page.evaluate((scenarioId) => {
              const chess = (
                window as unknown as {
                  __chess: {
                    exerciseAnnouncementScenario(scenario: string): Promise<void>;
                  };
                }
              ).__chess;
              return chess.exerciseAnnouncementScenario(scenarioId);
            }, expectation.scenario);
            await page.waitForTimeout(1_000);
          });
          const utterances = spokenPhrase.trim() ? [spokenPhrase] : [];
          observations.push({
            source: runner,
            claim: `live-region:${expectation.scenario}`,
            atVersion: null,
            os: process.platform,
            browser: runner === "nvda" ? "chromium" : "webkit",
            command: `exerciseAnnouncementScenario(${expectation.scenario})`,
            utterances,
            capturedAt: new Date().toISOString(),
          });
        }
        return observations;
      });
    },
  });

  return {
    scenarioId: AG5_SCENARIO_ID,
    runId,
    stateFingerprint: `${browser}:live-region`,
    ariaSnapshots,
    cdpAxTrees,
    axe: [],
    keyboardTraces: [],
    atObservations,
    infrastructureLimitations,
  };
}
