/**
 * AG-5's concrete scenario: the app-root live-region announcement policy. The browser tier
 * captures the two regions' ARIA semantics; the AT tier drives each policy operation through
 * `window.__chess.exerciseAnnouncementScenario` with a real screen reader live and slices its
 * utterance log per operation — exactly one complete expected message, no progress-tick speech,
 * no truncation, and no overlap with the next message.
 *
 * Note that `operation-started` and `operation-completed` run the *same* command: one real
 * `audit_repertoire_moves` announces its start through `registerOperation` and its outcome through
 * `settleOperation`, so each of those two scenarios emits both messages and asserts a different one
 * of them. `operation-failed` likewise emits a polite start followed by an assertive failure — that
 * one lands in the other region, which is why both regions are cleared and observed here rather
 * than just the polite one.
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
  /**
   * Lowercase substring of this scenario's own *rendered* message, used to hold the capture open
   * until the region actually carries it. Kept separate from `requiredTokens` because a screen
   * reader rewrites what it speaks (NVDA says "dot pgn" for ".pgn"), so spoken text is not a safe
   * predicate for DOM state.
   */
  readonly renderedText: string;
}

export const ANNOUNCEMENT_SCENARIOS: readonly AnnouncementScenarioExpectation[] = [
  {
    scenario: "document-restored",
    requiredTokens: ["restored", "autosave"],
    forbiddenTokens: [],
    maxUtterances: 4,
    renderedText: "from autosave",
  },
  {
    scenario: "operation-started",
    requiredTokens: ["audit", "started"],
    forbiddenTokens: ["progress"],
    maxUtterances: 4,
    renderedText: "started.",
  },
  {
    scenario: "operation-completed",
    requiredTokens: ["audit", "completed"],
    forbiddenTokens: ["progress"],
    maxUtterances: 4,
    renderedText: "completed",
  },
  {
    scenario: "operation-cancelled",
    requiredTokens: ["cancelled"],
    forbiddenTokens: [],
    maxUtterances: 4,
    renderedText: "cancelled",
  },
  {
    scenario: "operation-failed",
    requiredTokens: ["failed"],
    forbiddenTokens: [],
    maxUtterances: 5,
    renderedText: "failed",
  },
];

/** How long any scenario may take to put its first message on screen. */
const FIRST_MESSAGE_TIMEOUT_MS = 20_000;
/**
 * How much longer to wait for the scenario's *own* message once something has been announced.
 * Bounded and non-fatal on purpose: a fast operation can replace its own "started" text before the
 * DOM is ever observed carrying it (core-status.spec.ts records the same race), and a window opened
 * on the first message still spans the rest of the operation's speech.
 */
const OWN_MESSAGE_TIMEOUT_MS = 2_500;

interface AnnouncementDriver {
  exerciseAnnouncementScenario(scenario: string): Promise<void>;
  resetAnnouncementsForTesting(): void;
}

/**
 * Empty both live regions and wait for the DOM to actually reflect it.
 *
 * Run 33030807526 failed five of ten AG-5 claims for one reason, and it is this: nothing cleared
 * the regions between scenarios. `AppLiveRegion` renders the message through `<Show>`, so Solid
 * keeps the same paragraph node and only patches its text — and a write whose text equals what is
 * already displayed is not a DOM mutation at all, so no live-region notification fires and no
 * screen reader says anything. That is exactly what the evidence showed: `operation-completed`
 * returned "(nothing)" on NVDA because the preceding `operation-started` scenario runs the
 * identical command and had already left "Prescribed-move audit completed: 3 result(s)" on screen,
 * and `operation-failed` was silent on both runners because this scenario's own browser-tier
 * warm-up fires `operation-failed` first and had already left the identical text in the assertive
 * region. core-status.spec.ts's UX-012 test resets between scenarios for this reason and passes;
 * this loop did not. The app is not at fault — the same messages announce correctly from an empty
 * region.
 */
async function resetLiveRegions(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __chess: AnnouncementDriver }).__chess.resetAnnouncementsForTesting();
  });
  await page.waitForFunction(() => document.querySelector("[data-app-live-region] p") === null, {
    timeout: FIRST_MESSAGE_TIMEOUT_MS,
  });
}

/**
 * Start one policy operation and return as soon as its message is on screen, without waiting for
 * the operation itself to finish.
 *
 * This is the second half of run 33030807526's VoiceOver failures. Guidepup's VoiceOver capture
 * polls `lastSpokenPhrase()` — the caption, which holds only the most recent phrase — and it starts
 * polling *after* the captured action resolves. The previous action awaited the whole operation and
 * then slept a further second, so by the time polling began the early messages had been spoken and
 * scrolled out of the caption: `operation-started` came back holding the *completion* text. Opening
 * the window at the first rendered message instead lets VoiceOver's own stability polling
 * accumulate every phrase from that point on (it pushes each new phrase and joins them). NVDA is
 * unaffected either way: its client adds its speech listener *before* the action and keeps a
 * one-second silence debounce afterwards, so it was never blind here.
 */
async function startAnnouncementScenario(
  page: Page,
  expectation: AnnouncementScenarioExpectation,
): Promise<void> {
  await page.evaluate((scenarioId) => {
    const chess = (window as unknown as { __chess: AnnouncementDriver }).__chess;
    void chess.exerciseAnnouncementScenario(scenarioId).catch(() => undefined);
  }, expectation.scenario);
  await page.waitForFunction(() => document.querySelector("[data-app-live-region] p") !== null, {
    timeout: FIRST_MESSAGE_TIMEOUT_MS,
  });
  await page
    .waitForFunction(
      (text) =>
        Array.from(document.querySelectorAll("[data-app-live-region] p")).some((paragraph) =>
          (paragraph.textContent ?? "").toLowerCase().includes(text),
        ),
      expectation.renderedText,
      { timeout: OWN_MESSAGE_TIMEOUT_MS },
    )
    .catch(() => undefined);
}

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
  // container. This exercise leaves its text in both regions, which is what the AT loop below has
  // to undo before its own first scenario: announce()'s 500 ms de-duplication window elapsing is
  // NOT enough on its own, because re-announcing identical text patches the paragraph to the value
  // it already holds and never mutates the DOM at all. resetLiveRegions handles that; run
  // 33030807526 is what happens without it.
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
          // Empty the regions first so this scenario's message is a real DOM change rather than a
          // no-op rewrite of text the previous scenario left on screen — see resetLiveRegions.
          await resetLiveRegions(page);
          await session.focusBrowser();
          await session.since(); // drain stale state before the operation
          // The live-region update is triggered by page.evaluate — an external (Playwright)
          // action, not a screen-reader-driven press/perform — so since()'s spokenPhraseLog
          // diffing cannot see its speech at all (see withScreenReader's top comment). Guidepup's
          // own capture() exists for exactly this: it records speech spoken during an
          // externally-driven action.
          // The action deliberately returns at the first rendered message instead of awaiting the
          // whole operation and a trailing settle: both drivers keep recording after the action
          // resolves (NVDA on a silence debounce, VoiceOver by polling until the spoken phrase
          // stabilises), so an early return widens the window rather than truncating it. See
          // startAnnouncementScenario for the run-33030807526 evidence behind that.
          const { spokenPhrase } = await session.captureExternalAction(() =>
            startAnnouncementScenario(page, expectation),
          );
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
