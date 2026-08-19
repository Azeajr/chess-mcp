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

/** How long to let a screen reader finish responding to a command before reading its log. */
const SETTLE_MS = 1000;
/** How many virtual-cursor steps to take when checking the background is unreachable. */
const VIRTUAL_CURSOR_STEPS = 12;

/**
 * The caller's dialog, expressed as the DOM settling this session must wait for. The key presses
 * themselves are issued by the screen reader, not by the caller — see captureAtObservations.
 */
export interface AtDialogSteps {
  /** Resolve once the dialog is gone, after the screen reader pressed Escape. */
  readonly awaitClosed: () => Promise<void>;
  /** Resolve once the dialog is present, after the screen reader activated the opener. */
  readonly awaitOpen: () => Promise<void>;
}

/**
 * Runs one real screen-reader session across a full open/close/reopen cycle and returns what it
 * actually said at each point, as one AtObservation per AG-1 claim.
 *
 * Every key that should produce an announcement is pressed *by the screen reader*, never by
 * Playwright. That is not a stylistic choice. Both drivers record speech only while one of their
 * own actions is in flight: NVDAClient.js pushes into its spoken-phrase log inside the queued
 * action path, and VoiceOverClient's enqueueAndTap "captures the logs for the performed action".
 * Speech provoked by a Playwright key press is emitted and then dropped, which is why runs
 * 32231445756 and 32232144892 both recorded "(nothing)" for the announcement at 1.5s and again at
 * 8s — it was never a timing problem, and no amount of waiting could have fixed it.
 *
 * Ordering: the dialog is already open when this is called (the browser-tier collectors need it
 * open, and running them with a screen reader live would bury the utterances that matter), so the
 * cycle is report focus → Escape → report focus → Enter → virtual-cursor sweep. It deliberately
 * ends with the dialog open again so the keyboard trace that runs after this is unaffected.
 *
 * Throws if called on an unsupported platform — callers must check currentPlatformSupports()
 * first and record an InfrastructureLimitation instead.
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
      press(key: string): Promise<void>;
      next(): Promise<void>;
      perform(command: T["keyboardCommands"][keyof T["keyboardCommands"]]): Promise<void>;
    },
  ): Promise<readonly AtObservation[]> {
    await screenReader.start();
    try {
      const commands = screenReader.keyboardCommands as Record<
        string,
        T["keyboardCommands"][keyof T["keyboardCommands"]] | undefined
      >;
      const focusCommand = commands[focusCommandName];
      if (!focusCommand) throw new Error(`Unknown ${runner} keyboard command: ${focusCommandName}`);

      // Re-assert app focus before every command, not once per session. Run 32231445756 showed
      // VoiceOver falling back to "VoiceOver Settings activity" — the exact symptom run
      // 32209308823 diagnosed — because this session is long enough, with real state changes in
      // it, for macOS to hand focus back to VoiceOver's own UI in between.
      const focusBrowser = async () => {
        if (runner !== "voiceover") return;
        await macOSActivate(WEBKIT_MACOS_APPLICATION_NAME);
        await page?.bringToFront();
      };

      // spokenPhraseLog() is cumulative from start(), so each claim reads only the phrases spoken
      // since the previous one. Without this every observation would restate the whole session
      // and "did the screen reader say X here" would collapse into "did it ever say X".
      let spokenSoFar = 0;
      const since = async (): Promise<readonly string[]> => {
        await page?.waitForTimeout(SETTLE_MS);
        const log = await screenReader.spokenPhraseLog();
        const fresh = log.slice(spokenSoFar).filter((phrase) => phrase.trim() !== "");
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
      await focusBrowser();
      await since();

      await screenReader.perform(focusCommand);
      const focusReport = observe("focus-report", focusCommandName, await since());

      await focusBrowser();
      await screenReader.press("Escape");
      await steps.awaitClosed();
      await screenReader.perform(focusCommand);
      const focusReturn = observe("focus-return", focusCommandName, await since());

      await focusBrowser();
      // Enter on the opener, which the close just restored focus to. Activating through the
      // screen reader is what makes the dialog's own entry announcement land in the log.
      await screenReader.press("Enter");
      await steps.awaitOpen();
      const announcement = observe(
        "dialog-announcement",
        "press Enter on the opener",
        await since(),
      );

      // Virtual-cursor sweep: AG-1 asks that the background not be reachable this way, and the
      // review cursor is a different thing from DOM focus — which is exactly why it can reach
      // content a Tab press cannot.
      await focusBrowser();
      const sweep: string[] = [];
      for (let step = 0; step < VIRTUAL_CURSOR_STEPS; step += 1) {
        await screenReader.next();
        sweep.push(...(await since()));
      }
      const background = observe(
        "background-unreachable",
        `next() x${VIRTUAL_CURSOR_STEPS}`,
        sweep,
      );

      return [announcement, background, focusReport, focusReturn];
    } finally {
      await screenReader.stop();
    }
  }

  return runner === "nvda" ? run(nvda) : run(voiceOver);
}
