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
import type { AtClaim, AtObservation, InfrastructureLimitation } from "../evidence-schema";
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
/** How long any single UI state change may take before the session gives up on it. */
export const STEP_TIMEOUT_MS = 20_000;

/**
 * The caller's dialog, expressed as the DOM settling this session must wait for. The key presses
 * themselves are issued by the screen reader, not by the caller — see captureAtObservations.
 */
export interface AtDialogSteps {
  /** Resolve once the dialog is gone, after the screen reader pressed Escape. */
  readonly awaitClosed: () => Promise<void>;
  /** Resolve once the dialog is present, after the screen reader activated the opener. */
  readonly awaitOpen: () => Promise<void>;
  /**
   * Put real DOM focus back inside the open dialog. The virtual-cursor sweep moves the review
   * cursor, and the review cursor drags DOM focus with it, so after a sweep the next key press has
   * no predictable target. Run 32239829988's VoiceOver worker hung here until its test timed out.
   */
  readonly refocusDialog: () => Promise<void>;
}

export interface AtTreeSteps {
  /** Put DOM focus on the tree entry item used for role and level evidence. */
  readonly focusEntryItem: () => Promise<void>;
  /** Put DOM focus on the item that owns the variation group's expanded state. */
  readonly focusBranchItem: () => Promise<void>;
  /** Put DOM focus on the expected target when an AT intercepts the traversal key. */
  readonly focusTraversalTarget: () => Promise<void>;
  /** True when the app received the traversal key and moved focus to the expected item. */
  readonly traversalReachedTarget: () => Promise<boolean>;
  /** Resolve once the branch item exposes the requested expanded state. */
  readonly awaitExpanded: (expanded: boolean) => Promise<void>;
  readonly traversalKey: string;
}

/** Thrown when a dialog never reached the state a step was waiting for. */
class AtStepTimeout extends Error {}

/**
 * Bounds a wait so a stuck UI becomes a recorded, diagnosable observation instead of an opaque
 * job timeout with no evidence attached to it.
 */
export async function within(label: string, ms: number, step: () => Promise<void>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      step(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new AtStepTimeout(`${label} did not happen within ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * One live screen-reader session, reduced to the operations a scenario cycle actually needs. Every
 * hard-won invariant in this module's header is enforced here rather than restated in each cycle:
 * `focusBrowser` re-asserts app focus, `since` slices the cumulative log, and `observe` stamps the
 * observation with the real runner, OS, and browser.
 */
export interface AtSession {
  readonly runner: AtRunnerId;
  /** The runner's own "report what currently has focus" command name, for the `command` field. */
  readonly focusCommandName: string;
  /** Command sequence that describes the focused item's full accessibility semantics. */
  readonly semanticFocusCommandName: string;
  /** Re-assert OS-level focus on the browser. Call immediately before every command. */
  focusBrowser(): Promise<void>;
  /** Run the runner's own report-current-focus command. */
  reportFocus(): Promise<void>;
  /** Describe the focused item through the AT cursor, including composite role/state context. */
  reportSemanticFocus(): Promise<void>;
  /** Press a key *as the screen reader*, so whatever it says is recorded. */
  press(key: string): Promise<void>;
  /** Advance the screen reader's own review/browse cursor by one step. */
  next(): Promise<void>;
  /** Phrases spoken since the previous call, blank ones dropped. */
  since(): Promise<readonly string[]>;
  observe(claim: AtClaim, command: string, utterances: readonly string[]): AtObservation;
}

/**
 * Starts a real screen reader, hands `body` a session, and stops it again no matter what happened.
 *
 * Every key that should produce an announcement must be pressed *by the screen reader*, never by
 * Playwright. That is not a stylistic choice. Both drivers record speech only while one of their
 * own actions is in flight: NVDAClient.js pushes into its spoken-phrase log inside the queued
 * action path, and VoiceOverClient's enqueueAndTap "captures the logs for the performed action".
 * Speech provoked by a Playwright key press is emitted and then dropped, which is why runs
 * 32231445756 and 32232144892 both recorded "(nothing)" for the announcement at 1.5s and again at
 * 8s — it was never a timing problem, and no amount of waiting could have fixed it.
 *
 * Throws if called on an unsupported platform — callers must check currentPlatformSupports()
 * first and record an InfrastructureLimitation instead.
 */
export async function withScreenReader<T>(
  runner: AtRunnerId,
  page: Page | undefined,
  body: (session: AtSession) => Promise<T>,
): Promise<T> {
  if (!currentPlatformSupports(runner)) {
    throw new Error(
      `withScreenReader(${runner}) called on ${process.platform}; check currentPlatformSupports() first.`,
    );
  }
  // Dynamic import: @guidepup/guidepup has no Linux build, so a static import would break
  // typecheck/build on every non-Windows, non-MacOS worker, including this repo's own CI Node job.
  const { nvda, voiceOver, macOSActivate } = await import("@guidepup/guidepup");
  const focusCommandName = FOCUS_COMMAND[runner];

  async function run<T2 extends { keyboardCommands: object }>(
    screenReader: T2 & {
      start(): Promise<void>;
      stop(): Promise<void>;
      spokenPhraseLog(): Promise<string[]>;
      press(key: string): Promise<void>;
      next(): Promise<void>;
      perform(command: T2["keyboardCommands"][keyof T2["keyboardCommands"]]): Promise<void>;
    },
  ): Promise<T> {
    await screenReader.start();
    try {
      const commands = screenReader.keyboardCommands as Record<
        string,
        T2["keyboardCommands"][keyof T2["keyboardCommands"]] | undefined
      >;
      const focusCommand = commands[focusCommandName];
      if (!focusCommand) throw new Error(`Unknown ${runner} keyboard command: ${focusCommandName}`);
      const cursorToFocusCommand = commands.moveCursorToKeyboardFocus;
      const describeCursorCommand = commands.describeItem;
      if (runner === "voiceover" && (!cursorToFocusCommand || !describeCursorCommand)) {
        throw new Error("VoiceOver semantic focus commands are unavailable.");
      }

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

      return await body({
        runner,
        focusCommandName,
        semanticFocusCommandName:
          runner === "voiceover" ? "moveCursorToKeyboardFocus; describeItem" : focusCommandName,
        focusBrowser,
        since,
        reportFocus: async () => {
          await screenReader.perform(focusCommand);
        },
        reportSemanticFocus: async () => {
          if (runner === "voiceover") {
            await screenReader.perform(cursorToFocusCommand!);
            await screenReader.perform(describeCursorCommand!);
            return;
          }
          await screenReader.perform(focusCommand);
        },
        press: async (key) => {
          await screenReader.press(key);
        },
        next: async () => {
          await screenReader.next();
        },
        observe: (claim, command, utterances) => ({
          source: runner,
          claim,
          atVersion: null,
          os: process.platform,
          browser: runner === "nvda" ? "chromium" : "webkit",
          command,
          utterances,
          capturedAt: new Date().toISOString(),
        }),
      });
    } finally {
      await screenReader.stop();
    }
  }

  return runner === "nvda" ? run(nvda) : run(voiceOver);
}

/**
 * Runs one real screen-reader session across a full open/close/reopen cycle and returns what it
 * actually said at each point, as one AtObservation per AG-1 claim.
 *
 * Ordering: the dialog is already open when this is called (the browser-tier collectors need it
 * open, and running them with a screen reader live would bury the utterances that matter), so the
 * cycle is report focus → virtual-cursor sweep → Escape → report focus → Enter. It deliberately
 * ends with the dialog open again so the keyboard trace that runs after this is unaffected.
 */
export async function captureDialogObservations(
  runner: AtRunnerId,
  page: Page | undefined,
  steps: AtDialogSteps,
): Promise<readonly AtObservation[]> {
  const captureOnce = () =>
    withScreenReader(runner, page, async (session) => {
      // Discard whatever the screen reader said while starting up — its own greeting, the desktop,
      // the browser chrome. None of it is evidence about this dialog.
      await session.focusBrowser();
      await session.since();

      await session.reportFocus();
      const focusReport = session.observe(
        "focus-report",
        session.focusCommandName,
        await session.since(),
      );

      // Virtual-cursor sweep: AG-1 asks that the background not be reachable this way, and the
      // review cursor is a different thing from DOM focus — which is exactly why it can reach
      // content a Tab press cannot. It runs before the close/reopen, not after, because moving the
      // review cursor drags DOM focus with it: run 32237617773 ended its session with focus on an
      // unnamed radio deep in the dialog, so the keyboard trace that follows started from a
      // different place on that worker than on every other engine. Reopening last means the
      // dialog remounts and sets its own initial focus, handing the trace a clean, identical
      // starting state everywhere.
      await session.focusBrowser();
      for (let step = 0; step < VIRTUAL_CURSOR_STEPS; step += 1) {
        await session.next();
      }
      // Drained once after the whole sweep rather than after each step. The claim is about where
      // the cursor got to across the sweep, not about any individual step, and each drain costs a
      // full settle — twelve of them pushed the VoiceOver worker past its test timeout in run
      // 32238998739. Each next() is a guidepup action, so every step's speech is already in the
      // log by the time this reads it.
      const background = session.observe(
        "background-unreachable",
        `next() x${VIRTUAL_CURSOR_STEPS}`,
        await session.since(),
      );

      // Put DOM focus back somewhere real before pressing anything: the sweep just moved it.
      await steps.refocusDialog();
      await session.focusBrowser();
      await session.press("Escape");
      await within("dialog close", STEP_TIMEOUT_MS, steps.awaitClosed);
      await session.reportFocus();
      const focusReturn = session.observe(
        "focus-return",
        session.focusCommandName,
        await session.since(),
      );

      await session.focusBrowser();
      // Enter on the opener, which the close just restored focus to. Activating through the
      // screen reader is what makes the dialog's own entry announcement land in the log.
      await session.press("Enter");
      await within("dialog reopen", STEP_TIMEOUT_MS, steps.awaitOpen);
      const announcement = session.observe(
        "dialog-announcement",
        "press Enter on the opener",
        await session.since(),
      );

      return [announcement, background, focusReport, focusReturn];
    });

  const first = await captureOnce();
  const announcement = first.find((observation) => observation.claim === "dialog-announcement");
  // A native AT command can occasionally complete without Guidepup receiving any speech event.
  // Restart the native session once for that transport-level absence. Semantic mismatches are
  // never retried or interpreted here, and a second empty session still fails deterministically.
  return announcement?.utterances.length === 0 ? captureOnce() : first;
}

/**
 * Captures the four AG-3 claims in one real screen-reader session. DOM focus is established
 * silently before each observation; every announcement-bearing command is issued through
 * Guidepup so its utterance log actually records the speech.
 */
export function captureTreeObservations(
  runner: AtRunnerId,
  page: Page,
  steps: AtTreeSteps,
): Promise<readonly AtObservation[]> {
  return withScreenReader(runner, page, async (session) => {
    await session.focusBrowser();
    await session.since();

    await steps.focusEntryItem();
    await session.focusBrowser();
    await session.since();
    await session.reportSemanticFocus();
    const entryUtterances = await session.since();
    const treeRole = session.observe(
      "tree-role",
      session.semanticFocusCommandName,
      entryUtterances,
    );
    const itemLevel = session.observe(
      "item-level",
      session.semanticFocusCommandName,
      entryUtterances,
    );

    await steps.focusBranchItem();
    await session.focusBrowser();
    await session.since();
    await session.reportSemanticFocus();
    const expandedUtterances = await session.since();

    await session.focusBrowser();
    await session.press("Space");
    await within("tree branch collapse", STEP_TIMEOUT_MS, () => steps.awaitExpanded(false));
    const toggleUtterances = await session.since();
    await session.focusBrowser();
    await session.reportSemanticFocus();
    const collapsedUtterances = await session.since();
    const expandedState = session.observe(
      "expanded-state",
      `${session.semanticFocusCommandName}; press Space; ${session.semanticFocusCommandName}`,
      [...expandedUtterances, ...toggleUtterances, ...collapsedUtterances],
    );

    // Restore the fixture before traversal so this session leaves the page in its initial state.
    await session.focusBrowser();
    await session.press("Space");
    await within("tree branch expand", STEP_TIMEOUT_MS, () => steps.awaitExpanded(true));
    await session.since();

    await steps.focusBranchItem();
    await session.focusBrowser();
    await session.since();
    await session.press(steps.traversalKey);
    let traversalUtterances = await session.since();
    let traversalCommand = `press ${steps.traversalKey}`;

    // NVDA browse mode and VoiceOver Quick Nav may consume arrows instead of forwarding them to
    // the web app. The browser contract already proves the app handler; in that case move DOM
    // focus silently and ask the real AT to describe the resulting item.
    if (!(await steps.traversalReachedTarget())) {
      await steps.focusTraversalTarget();
      await session.focusBrowser();
      await session.since();
      await session.reportSemanticFocus();
      traversalUtterances = await session.since();
      traversalCommand = `focus target via DOM; ${session.semanticFocusCommandName} (${steps.traversalKey} intercepted)`;
    }
    const traversalVerbosity = session.observe(
      "traversal-verbosity",
      traversalCommand,
      traversalUtterances,
    );

    return [treeRole, itemLevel, expandedState, traversalVerbosity];
  });
}
