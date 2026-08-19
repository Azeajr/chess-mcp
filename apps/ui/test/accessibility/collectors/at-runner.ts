/**
 * Real assistive-technology evidence via Guidepup (MIT, github.com/guidepup/guidepup), which
 * drives actual NVDA on Windows and actual VoiceOver on MacOS through each OS's own automation
 * surface — not a "screen reader simulator". No fallback path in this module produces an
 * AtObservation without a real screen reader having actually spoken; a worker that cannot run
 * one returns an InfrastructureLimitation record instead.
 *
 * Uses screenReader.next() rather than perform(keyboardCommands.X): CI run 32206066681 found
 * that VoiceOver's "findNextControl" keyboard command hangs (it opens VoiceOver's interactive
 * Find UI rather than taking a single navigation step — the test timed out waiting for it).
 * next() is the one navigation primitive documented as identical across both screen readers
 * (github.com/guidepup/guidepup's own "Basic Navigation — Cross-Platform" example) rather than a
 * per-platform keyCodeCommands map entry guessed from a different, more complex example.
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

/**
 * Starts the real screen reader, steps forward once with next(), and returns its actual spoken
 * output. Throws if called on an unsupported platform — callers must check
 * currentPlatformSupports() first and record an InfrastructureLimitation instead of calling this.
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
  const screenReader = runner === "nvda" ? nvda : voiceOver;

  await screenReader.start();
  try {
    await screenReader.next();
    const utterances = await screenReader.spokenPhraseLog();
    return {
      source: runner,
      atVersion: null,
      os: process.platform,
      browser: runner === "nvda" ? "chromium" : "webkit",
      command: "next",
      utterances,
      capturedAt: new Date().toISOString(),
    };
  } finally {
    await screenReader.stop();
  }
}
