/**
 * AG-1's concrete scenarios. AG-1's scope is the `Dialog` primitive *and its consumers*, so the
 * evidence has to cover a dialog actually built on the primitive — Settings is one of WP-007's
 * three overlays. Strategic Fit is kept alongside it because it is the primitive's extraction
 * source and the surface `WP-033` will migrate onto it, so a regression there is worth catching
 * even though it is not itself an AG-1 consumer yet.
 */
import type { EvidenceBundle } from "../evidence-schema";
import type { DialogScenarioDefinition } from "./dialog-scenario";

export const AG1_SCENARIO_ID = "ag-1-strategic-fit-dialog";
export const AG1_OPENER_NAME = "Open Strategic Fit";
export const AG1_DIALOG_NAME = "Strategic Fit";
export const AG1_BACKGROUND_CONTROL_NAME = "Open PGN";

/** The primitive's own contract, observed through one of its three real consumers. */
export const SETTINGS_SCENARIO: DialogScenarioDefinition = {
  id: "ag-1-settings-dialog",
  openerName: "Settings",
  dialogName: "Settings",
  backgroundControlName: "Open PGN",
  scopeSelector: ".ui-dialog, [role='dialog']",
  traceKeys: ["Tab", "Tab", "Tab", "Shift+Tab", "Escape"],
};

export const STRATEGIC_FIT_SCENARIO: DialogScenarioDefinition = {
  id: AG1_SCENARIO_ID,
  openerName: AG1_OPENER_NAME,
  dialogName: AG1_DIALOG_NAME,
  backgroundControlName: AG1_BACKGROUND_CONTROL_NAME,
  scopeSelector: ".strategic-fit-workspace, [role='dialog']",
  traceKeys: ["Tab", "Tab", "Tab", "Shift+Tab", "Escape"],
};

export const DIALOG_SCENARIOS: readonly DialogScenarioDefinition[] = [
  SETTINGS_SCENARIO,
  STRATEGIC_FIT_SCENARIO,
];

export function scenarioById(id: string): DialogScenarioDefinition | undefined {
  return DIALOG_SCENARIOS.find((scenario) => scenario.id === id);
}

/** Merge per-browser bundles from the same scenario run into the one the verdict engine reads. */
export function mergeBundles(bundles: readonly EvidenceBundle[]): EvidenceBundle {
  const [first] = bundles;
  if (!first) throw new Error("mergeBundles requires at least one bundle.");
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
  };
}

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
