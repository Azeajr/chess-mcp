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
 * own windows/NVDA/keyCodeCommands.d.ts and macOS/VoiceOver/keyCodeCommands.d.ts directly, not
 * guessed from README prose. Not yet re-verified by an actual run.
 */
import type { AtObservation, InfrastructureLimitation } from "../evidence-schema";

export type AtRunnerId = "nvda" | "voiceover";

const PLATFORM_REQUIREMENT: Record<AtRunnerId, NodeJS.Platform> = {
  nvda: "win32",
  voiceover: "darwin",
};

const FOCUS_COMMAND: Record<AtRunnerId, string> = {
  nvda: "reportCurrentFocus",
  voiceover: "describeItemWithKeyboardFocus",
};

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
export async function captureAtObservation(runner: AtRunnerId): Promise<AtObservation> {
  if (!currentPlatformSupports(runner)) {
    throw new Error(
      `captureAtObservation(${runner}) called on ${process.platform}; check currentPlatformSupports() first.`,
    );
  }
  // Dynamic import: @guidepup/guidepup has no Linux build, so a static import would break
  // typecheck/build on every non-Windows, non-MacOS worker, including this repo's own CI Node job.
  const { nvda, voiceOver } = await import("@guidepup/guidepup");
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
