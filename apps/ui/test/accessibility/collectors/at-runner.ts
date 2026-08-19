/**
 * Real assistive-technology evidence via Guidepup (MIT, github.com/guidepup/guidepup), which
 * drives actual NVDA on Windows and actual VoiceOver on MacOS through each OS's own automation
 * surface — not a "screen reader simulator". No fallback path in this module produces an
 * AtObservation without a real screen reader having actually spoken; a worker that cannot run
 * one returns an InfrastructureLimitation record instead.
 *
 * UNVERIFIED ON THIS MACHINE: this repository's dev/CI environment is Linux, which cannot run
 * NVDA or VoiceOver at all — Guidepup has no Linux target. Every line below is written against
 * Guidepup's documented API (README.md and guidepup-playwright README.md, fetched from
 * github.com/guidepup/guidepup and github.com/guidepup/guidepup-playwright) but has never
 * executed. First real execution happens on a windows-latest or macos-latest GitHub Actions
 * runner — see .github/workflows/accessibility.yml. Until that run happens and is inspected,
 * treat this module as designed-not-proven.
 */
import type { AtObservation, InfrastructureLimitation } from "../evidence-schema";

export type AtRunnerId = "nvda" | "voiceover";

const PLATFORM_REQUIREMENT: Record<AtRunnerId, NodeJS.Platform> = {
  nvda: "win32",
  voiceover: "darwin",
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

export interface AtScenarioSteps {
  /** Guidepup keyboard-command names, e.g. voiceOver.keyboardCommands.findNextControl. */
  readonly commands: readonly string[];
}

/**
 * Runs one scenario through a real screen reader and returns its actual spoken output. Throws if
 * called on an unsupported platform — callers must check currentPlatformSupports() first and
 * record an InfrastructureLimitation instead of calling this. Not invoked by any test in this
 * repository yet; see the module doc comment.
 */
export async function captureAtObservation(
  runner: AtRunnerId,
  steps: AtScenarioSteps,
): Promise<AtObservation> {
  if (!currentPlatformSupports(runner)) {
    throw new Error(
      `captureAtObservation(${runner}) called on ${process.platform}; check currentPlatformSupports() first.`,
    );
  }
  // Dynamic import: @guidepup/guidepup has no Linux build, so a static import would break
  // typecheck/build on every non-Windows, non-MacOS worker, including this repo's own CI Node job.
  const guidepup = await import("@guidepup/guidepup");

  // NVDA and VoiceOver each declare their own concrete KeyCodeCommand shape (Windows Key[] vs
  // macOS KeyCodes) and their own perform() overload. Branching fully, rather than collapsing
  // both instances into one `screenReader` variable, lets TS infer each command's exact type
  // from that instance's own keyboardCommands getter instead of forcing a manual cast.
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
      for (const commandName of steps.commands) {
        const commands = screenReader.keyboardCommands as Record<
          string,
          T["keyboardCommands"][keyof T["keyboardCommands"]] | undefined
        >;
        const command = commands[commandName];
        if (!command) throw new Error(`Unknown ${runner} keyboard command: ${commandName}`);
        await screenReader.perform(command);
      }
      return await screenReader.spokenPhraseLog();
    } finally {
      await screenReader.stop();
    }
  }

  const utterances = await (runner === "nvda" ? run(guidepup.nvda) : run(guidepup.voiceOver));
  return {
    source: runner,
    atVersion: null,
    os: process.platform,
    browser: runner === "nvda" ? "chromium" : "webkit",
    command: steps.commands.join(" -> "),
    utterances,
    capturedAt: new Date().toISOString(),
  };
}
