/**
 * The AT tier of a scenario run: attempt a real screen-reader session per runner, and turn every
 * way that can fail into a recorded InfrastructureLimitation rather than a lost run.
 *
 * Extracted from `scenarios/dialog-scenario.ts` so AG-3's move-tree scenario shares this bookkeeping
 * instead of copying it. The error handling is the reason it is shared: runs 32238998739 and
 * 32239829988 surfaced as opaque job timeouts with no artifact attached, and the try/catch below is
 * what turned that class of failure into something diagnosable.
 */
import type { AtObservation, InfrastructureLimitation } from "../evidence-schema";
import {
  currentPlatformSupports,
  infrastructureLimitationFor,
  type AtRunnerId,
} from "./at-runner";

const AT_RUNNERS: readonly AtRunnerId[] = ["nvda", "voiceover"];

export interface AtTierResult {
  readonly atObservations: readonly AtObservation[];
  readonly infrastructureLimitations: readonly InfrastructureLimitation[];
}

export interface AtTierOptions {
  /** Set true to attempt real AT capture when the platform supports it (off in the fast path). */
  readonly attemptAtCapture: boolean;
  /** Names this scenario in a limitation's reason, so a failure says which surface it was on. */
  readonly label: string;
  /** Runs one real screen-reader session. Called only on a platform that supports `runner`. */
  readonly capture: (runner: AtRunnerId) => Promise<readonly AtObservation[]>;
}

export async function collectAtTier(options: AtTierOptions): Promise<AtTierResult> {
  const atObservations: AtObservation[] = [];
  const infrastructureLimitations: InfrastructureLimitation[] = [];

  for (const runner of AT_RUNNERS) {
    if (!options.attemptAtCapture || !currentPlatformSupports(runner)) {
      infrastructureLimitations.push(infrastructureLimitationFor(runner));
      continue;
    }
    try {
      atObservations.push(...(await options.capture(runner)));
    } catch (error) {
      // A screen-reader session that gets stuck is evidence, not a reason to lose the whole run.
      infrastructureLimitations.push({
        ...infrastructureLimitationFor(runner),
        reason: `${runner} session did not complete for ${options.label}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }

  return { atObservations, infrastructureLimitations };
}
