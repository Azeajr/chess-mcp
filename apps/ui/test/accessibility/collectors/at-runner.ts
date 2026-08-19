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

/**
 * Starts the real screen reader, asks it to report whatever currently has real focus, and
 * returns its actual spoken output. Throws if called on an unsupported platform — callers must
 * check currentPlatformSupports() first and record an InfrastructureLimitation instead of
 * calling this. Callers are responsible for ensuring real DOM focus is already where it should
 * be (e.g. the Dialog primitive's own initial-focus behavior) before calling this — this function
 * only asks the AT to report focus, it does not set it.
 */
export async function captureAtObservation(
  runner: AtRunnerId,
  page?: Page,
): Promise<AtObservation> {
  if (!currentPlatformSupports(runner)) {
    throw new Error(
      `captureAtObservation(${runner}) called on ${process.platform}; check currentPlatformSupports() first.`,
    );
  }
  // Dynamic import: @guidepup/guidepup has no Linux build, so a static import would break
  // typecheck/build on every non-Windows, non-MacOS worker, including this repo's own CI Node job.
  const { nvda, voiceOver, macOSActivate } = await import("@guidepup/guidepup");
  const commandName = FOCUS_COMMAND[runner];

  async function run<T extends { keyboardCommands: object }>(
    screenReader: T & {
      start(): Promise<void>;
      stop(): Promise<void>;
      spokenPhraseLog(): Promise<string[]>;
      perform(command: T["keyboardCommands"][keyof T["keyboardCommands"]]): Promise<void>;
    },
  ): Promise<readonly string[]> {
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
      const command = commands[commandName];
      if (!command) throw new Error(`Unknown ${runner} keyboard command: ${commandName}`);
      await screenReader.perform(command);
      return await screenReader.spokenPhraseLog();
    } finally {
      await screenReader.stop();
    }
  }

  const utterances = await (runner === "nvda" ? run(nvda) : run(voiceOver));
  return {
    source: runner,
    atVersion: null,
    os: process.platform,
    browser: runner === "nvda" ? "chromium" : "webkit",
    command: commandName,
    utterances,
    capturedAt: new Date().toISOString(),
  };
}
