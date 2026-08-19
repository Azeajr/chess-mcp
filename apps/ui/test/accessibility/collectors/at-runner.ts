/**
 * Real assistive-technology evidence via Guidepup (MIT, github.com/guidepup/guidepup), which
 * drives actual NVDA on Windows and actual VoiceOver on MacOS through each OS's own automation
 * surface — not a "screen reader simulator". No fallback path in this module produces an
 * AtObservation without a real screen reader having actually spoken; a worker that cannot run
 * one returns an InfrastructureLimitation record instead.
 *
 * Uses reportCurrentFocus (NVDA) / describeItemWithKeyboardFocus (VoiceOver) rather than next():
 * runs 32206750401 and 32207555004 found next() moves each screen reader's own independent
 * review/browse cursor, which is not the same thing as real DOM focus and was never reliably
 * synced to it — NVDA read the page title, VoiceOver read "AccessibilityUIServer has no windows".
 * Both these commands instead report whatever the OS currently considers focused, sidestepping
 * cursor-position entirely — confirmed real by reading the installed @guidepup/guidepup package's
 * own windows/NVDA/keyCodeCommands.d.ts and macOS/VoiceOver/keyCodeCommands.d.ts directly.
 *
 * Run 32208455039 fixed NVDA for real ("Return to repertoire, button, focused" — correct) but
 * VoiceOver still reported "Desktop group has keyboard focus": the browser window itself never
 * received real OS-level focus on that macOS runner (confirmed by keyboardTraces[3] on the same
 * run reproducing the exact same Tab-loses-focus pattern seen on two prior runs, now with the
 * dialog-heading click ruled out as the cause — one root cause, not two). macOSActivate is
 * exported directly from @guidepup/guidepup (not @guidepup/playwright, so no dependency
 * collision) and is exactly what @guidepup/guidepup-playwright's own real
 * VoiceOverPlaywright.navigateToWebContent() implementation calls first, before anything else,
 * to fix this same problem — read directly from
 * github.com/guidepup/guidepup-playwright/blob/main/src/voiceOverTest.ts, not guessed.
 * "Playwright" is that same file's applicationNameMap.webkit value — the real macOS application
 * name Playwright's bundled WebKit build registers as, not a guess.
 *
 * Run 32209308823: VoiceOver moved from "Desktop group has keyboard focus" to "VoiceOver Settings
 * activity" — progress, but still not page content, and keyboardTraces[3] reproduced the same
 * Tab-loses-focus anomaly a 4th consecutive time. Root cause found by re-reading
 * navigateToWebContent() call order, not guessed: the reference calls macOSActivate (app-level
 * activation) THEN page.bringToFront() (tab-level, within that now-frontmost app) — in that order,
 * back-to-back. This module previously only did macOSActivate; ag-1-dialog.ts called
 * page.bringToFront() separately, earlier, before the AT loop even started. Net effect: the two
 * calls ran in reverse order with an unrelated capture step (browser-tier evidence collection)
 * between them, giving the OS time to refocus something else — plausibly VoiceOver's own Settings
 * UI — before the AT command actually ran. Fixed by taking page here and issuing both calls
 * back-to-back, in the reference's order, immediately before the focus-report command.
 *
 * Run 32210865750: the ordering fix above worked — VoiceOver now reports real page content
 * ("Return to repertoire button has keyboard focus", matching NVDA's real target).
 *
 * That run also showed a separate bug: the scenario's keyboard trace, run immediately after this
 * function returns, showed a real Tab press losing DOM focus mid-sequence. Tried and disproved:
 * screenReader.stop() leaving the macOS Accessibility API mid-teardown when the trace's first Tab
 * press landed (run 32212195952 added a 1s settle delay after stop() — anomaly reproduced
 * identically, 6th consecutive time, delay removed). Root cause found by reading the dialog's own
 * focus-trap handler (StrategicFitWorkspace.tsx): it only called .focus() explicitly at the wrap
 * boundary, relying on native Tab traversal in between — and macOS Safari's default "Full Keyboard
 * Access" setting (off by default) makes native Tab skip every <button> entirely. Nothing to do
 * with this module or VoiceOver; fixed in the dialog's own trap handler instead.
 */
import type { AtObservation, InfrastructureLimitation } from "../evidence-schema";
import type { Page } from "playwright/test";

export type AtRunnerId = "nvda" | "voiceover";

const PLATFORM_REQUIREMENT: Record<AtRunnerId, NodeJS.Platform> = {
  nvda: "win32",
  voiceover: "darwin",
};

const FOCUS_COMMAND: Record<AtRunnerId, string> = {
  nvda: "reportCurrentFocus",
  voiceover: "describeItemWithKeyboardFocus",
};

const WEBKIT_MACOS_APPLICATION_NAME = "Playwright";

export function currentPlatformSupports(runner: AtRunnerId): boolean {
  return process.platform === PLATFORM_REQUIREMENT[runner];
}

export function infrastructureLimitationFor(runner: AtRunnerId): InfrastructureLimitation {
  return {
    runner,
    reason: `${runner} requires ${PLATFORM_REQUIREMENT[runner]}; this worker is ${process.platform}.`,
    requiredPlatform: PLATFORM_REQUIREMENT[runner],
    currentPlatform: process.platform,
  };
}

/** How long to let a screen reader finish speaking before reading the log it spoke into. */
const SETTLE_MS = 1500;

/**
 * The caller's dialog, expressed as the two real user actions this session needs to drive. Both
 * run while the screen reader is live, which is the entire point: an announcement that is not
 * spoken during a real session is not evidence that it would be.
 */
export interface AtDialogSteps {
  /** Close the open dialog the way a user would, from the keyboard. */
  readonly close: () => Promise<void>;
  /** Reopen it, so the screen reader's own entry announcement lands in the spoken log. */
  readonly reopen: () => Promise<void>;
}

/**
 * Runs one real screen-reader session across a full open/close/reopen cycle and returns what it
 * actually said at each point, as one AtObservation per AG-1 claim.
 *
 * Ordering matters and is not arbitrary. The dialog is already open when this is called (the
 * browser-tier collectors need it open, and running them with a screen reader live would bury the
 * utterances that matter in unrelated chatter), so the cycle is: report focus → close → report
 * focus again → reopen. That yields the focus report, the focus-return-on-close report, and the
 * entry announcement from a single session, and it deliberately ends with the dialog open again
 * so the keyboard trace that runs after this is unaffected.
 *
 * The announcement specifically cannot be captured any other way: spokenPhraseLog() only contains
 * what was spoken since start(), and the screen reader starts long after the dialog first opened.
 *
 * Throws if called on an unsupported platform — callers must check currentPlatformSupports()
 * first and record an InfrastructureLimitation instead of calling this.
 */
export async function captureAtObservations(
  runner: AtRunnerId,
  page: Page | undefined,
  steps: AtDialogSteps,
): Promise<readonly AtObservation[]> {
  if (!currentPlatformSupports(runner)) {
    throw new Error(
      `captureAtObservations(${runner}) called on ${process.platform}; check currentPlatformSupports() first.`,
    );
  }
  // Dynamic import: @guidepup/guidepup has no Linux build, so a static import would break
  // typecheck/build on every non-Windows, non-MacOS worker, including this repo's own CI Node job.
  const { nvda, voiceOver, macOSActivate } = await import("@guidepup/guidepup");
  const focusCommandName = FOCUS_COMMAND[runner];

  async function run<T extends { keyboardCommands: object }>(
    screenReader: T & {
      start(): Promise<void>;
      stop(): Promise<void>;
      spokenPhraseLog(): Promise<string[]>;
      perform(command: T["keyboardCommands"][keyof T["keyboardCommands"]]): Promise<void>;
    },
  ): Promise<readonly AtObservation[]> {
    await screenReader.start();
    try {
      if (runner === "voiceover") {
        // App-level activation, THEN tab-level bringToFront, back-to-back, right before the
        // command — reference order, see module doc comment.
        await macOSActivate(WEBKIT_MACOS_APPLICATION_NAME);
        await page?.bringToFront();
      }
      const commands = screenReader.keyboardCommands as Record<
        string,
        T["keyboardCommands"][keyof T["keyboardCommands"]] | undefined
      >;
      const focusCommand = commands[focusCommandName];
      if (!focusCommand) throw new Error(`Unknown ${runner} keyboard command: ${focusCommandName}`);

      // spokenPhraseLog() is cumulative from start(), so each claim reads only the phrases spoken
      // since the previous one. Without this every observation would restate the whole session
      // and "did the screen reader say X here" would collapse into "did it ever say X".
      let spokenSoFar = 0;
      const since = async (): Promise<readonly string[]> => {
        await page?.waitForTimeout(SETTLE_MS);
        const log = await screenReader.spokenPhraseLog();
        const fresh = log.slice(spokenSoFar);
        spokenSoFar = log.length;
        return fresh;
      };
      const observe = (
        claim: AtObservation["claim"],
        command: string,
        utterances: readonly string[],
      ): AtObservation => ({
        source: runner,
        claim,
        atVersion: null,
        os: process.platform,
        browser: runner === "nvda" ? "chromium" : "webkit",
        command,
        utterances,
        capturedAt: new Date().toISOString(),
      });

      // Discard whatever the screen reader said while starting up — its own greeting, the desktop,
      // the browser chrome. None of it is evidence about this dialog.
      await since();

      await screenReader.perform(focusCommand);
      const focusReport = observe("focus-report", focusCommandName, await since());

      await steps.close();
      await screenReader.perform(focusCommand);
      const focusReturn = observe("focus-return", focusCommandName, await since());

      await steps.reopen();
      // No command here: the entry announcement is spoken by the screen reader on its own when
      // focus enters the dialog. Asking it to report focus instead would capture the answer to a
      // different question.
      const announcement = observe("dialog-announcement", "(unprompted on open)", await since());

      return [announcement, focusReport, focusReturn];
    } finally {
      await screenReader.stop();
    }
  }

  return runner === "nvda" ? run(nvda) : run(voiceOver);
}
