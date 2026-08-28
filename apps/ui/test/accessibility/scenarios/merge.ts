/**
 * Merging per-browser and per-CI-job evidence for one scenario into the single bundle the verdict
 * engine reads. Nothing here is scenario-specific — it moved out of `ag-1-dialog.ts` when AG-3's
 * move-tree scenario needed the same merge, so that a tree scenario does not import from a file
 * named after a dialog gate.
 */
import type { EvidenceBundle } from "../evidence-schema";

/** Merge bundles from the same scenario run into the one the verdict engine reads. */
export function mergeBundles(bundles: readonly EvidenceBundle[]): EvidenceBundle {
  const [first] = bundles;
  if (!first) throw new Error("mergeBundles requires at least one bundle.");
  // Concatenated, not taken from the first bundle: AG-2's arrow-state machine is scored per engine,
  // and keeping only one engine's walk would silently narrow a three-engine claim to one.
  const tabWalk = bundles.flatMap((bundle) => bundle.tabWalk ?? []);
  return {
    scenarioId: first.scenarioId,
    runId: first.runId,
    stateFingerprint: bundles.map((bundle) => bundle.stateFingerprint).join("|"),
    ariaSnapshots: bundles.flatMap((bundle) => bundle.ariaSnapshots),
    cdpAxTrees: bundles.flatMap((bundle) => bundle.cdpAxTrees),
    axe: bundles.flatMap((bundle) => bundle.axe),
    keyboardTraces: bundles.flatMap((bundle) => bundle.keyboardTraces),
    atObservations: bundles.flatMap((bundle) => bundle.atObservations),
    infrastructureLimitations: dedupeLimitations(
      bundles.flatMap((bundle) => bundle.infrastructureLimitations),
    ),
    ...(tabWalk.length > 0 ? { tabWalk } : {}),
  };
}

/**
 * One limitation per runner. Every non-supporting worker files the same "nvda requires win32" note,
 * and repeating it once per browser project would make a single platform split look like several
 * independent gaps in the merged report.
 */
function dedupeLimitations(
  limitations: readonly EvidenceBundle["infrastructureLimitations"][number][],
): EvidenceBundle["infrastructureLimitations"] {
  const seen = new Set<string>();
  return limitations.filter((limitation) => {
    if (seen.has(limitation.runner)) return false;
    seen.add(limitation.runner);
    return true;
  });
}
