/** Small UI-chrome state (drawer visibility, phone tab). */
import { createSignal } from "solid-js";

export const [settingsOpen, setSettingsOpen] = createSignal(false);

/**
 * Phone-only (≤720px) panel selector: which panel shows under the pinned board.
 *
 * WP-015 evaluated making "moves" the first-load tab. It is deliberately still "analysis": the
 * repertoire panel (and with it the Strategic Fit entry point) lives in that tab, so defaulting
 * elsewhere hides the app's primary analysis affordance behind an extra tap on first run.
 */
export type MobileTab = "analysis" | "moves" | "chat";
export const [mobileTab, setMobileTab] = createSignal<MobileTab>("analysis");

/** Additive Strategic Fit workspace chrome. Analysis lifecycle state belongs to Task 5.3. */
export type StrategicFitWorkspaceStage = "overview" | "findings" | "evidence" | "resolution";
export type StrategicFitWorkspaceRegionStatus = "empty" | "loading" | "error";

export interface StrategicFitWorkspaceRegionState {
  readonly status: StrategicFitWorkspaceRegionStatus;
  readonly message?: string;
}

const emptyStrategicFitWorkspaceRegions = (): Record<
  StrategicFitWorkspaceStage,
  StrategicFitWorkspaceRegionState
> => ({
  overview: { status: "empty" },
  findings: { status: "empty" },
  evidence: { status: "empty" },
  resolution: { status: "empty" },
});

export const [strategicFitWorkspaceOpen, setStrategicFitWorkspaceOpen] = createSignal(false);
export const [strategicFitWorkspaceStage, setStrategicFitWorkspaceStage] =
  createSignal<StrategicFitWorkspaceStage>("overview");
export const [strategicFitWorkspaceRegions, setStrategicFitWorkspaceRegions] = createSignal(
  emptyStrategicFitWorkspaceRegions(),
);

/**
 * Task 10.4 print/export mode. Every table equivalent renders its complete list and every
 * disclosure opens, so a printed page or an exported PDF never omits evidence that an on-screen
 * render cap withheld. Charts keep aggregating: a thousand overlapping dots do not print better.
 */
export const [strategicFitPrintExportMode, setStrategicFitPrintExportMode] = createSignal(false);

/**
 * WP-032: completed-analysis disclosure state. Running/provisional progress ignores these signals
 * and stays fully expanded; print/export mode also forces both blocks open. Keeping the user's
 * completed-state choice here (rather than inside one render) preserves it across stage switches.
 */
export const [strategicFitAnalysisPhasesExpanded, setStrategicFitAnalysisPhasesExpanded] =
  createSignal(false);
export const [strategicFitPreflightExpanded, setStrategicFitPreflightExpanded] =
  createSignal(false);

export type StrategicFitFindingQueueFilter =
  | { readonly kind: "all" }
  | {
      readonly kind: "classification";
      readonly classification: "forced-diversity" | "intentional-diversity";
    }
  | { readonly kind: "resolution"; readonly resolution: "unresolved" }
  | { readonly kind: "evidence"; readonly evidence: "insufficient" };

export interface StrategicFitFindingQueueIntent {
  readonly report_id: string;
  readonly source: string;
  readonly label: string;
  readonly filter: StrategicFitFindingQueueFilter;
}

export const [strategicFitFindingQueueIntent, setStrategicFitFindingQueueIntent] =
  createSignal<StrategicFitFindingQueueIntent | null>(null);

export function strategicFitFindingQueueFilterKey(filter: StrategicFitFindingQueueFilter): string {
  if (filter.kind === "classification") return `classification:${filter.classification}`;
  if (filter.kind === "resolution") return `resolution:${filter.resolution}`;
  if (filter.kind === "evidence") return `evidence:${filter.evidence}`;
  return "all";
}

export function openStrategicFitFindingQueue(intent: StrategicFitFindingQueueIntent) {
  setStrategicFitFindingQueueIntent(intent);
  setStrategicFitWorkspaceStage("findings");
}

export function setStrategicFitWorkspaceRegionState(
  region: StrategicFitWorkspaceStage,
  state: StrategicFitWorkspaceRegionState,
) {
  setStrategicFitWorkspaceRegions((current) => ({ ...current, [region]: { ...state } }));
}
