/** Small UI-chrome state (drawer visibility, phone tab). */
import { createSignal } from "solid-js";

export const [settingsOpen, setSettingsOpen] = createSignal(false);

/** Phone-only (≤720px) panel selector: which panel shows under the pinned board. */
export type MobileTab = "analysis" | "moves" | "chat";
export const [mobileTab, setMobileTab] = createSignal<MobileTab>("analysis");

/** Additive Strategic Fit workspace chrome. Analysis lifecycle state belongs to Task 5.3. */
export type StrategicFitWorkspaceStage = "overview" | "findings" | "evidence" | "resolution";
export type StrategicFitWorkspaceRegionStatus = "empty" | "loading" | "error";

export interface StrategicFitWorkspaceRegionState {
  readonly status: StrategicFitWorkspaceRegionStatus;
  readonly message?: string;
}

const emptyStrategicFitWorkspaceRegions = (): Record<StrategicFitWorkspaceStage, StrategicFitWorkspaceRegionState> => ({
  overview: { status: "empty" },
  findings: { status: "empty" },
  evidence: { status: "empty" },
  resolution: { status: "empty" },
});

export const [strategicFitWorkspaceOpen, setStrategicFitWorkspaceOpen] = createSignal(false);
export const [strategicFitWorkspaceStage, setStrategicFitWorkspaceStage] =
  createSignal<StrategicFitWorkspaceStage>("overview");
export const [strategicFitWorkspaceRegions, setStrategicFitWorkspaceRegions] =
  createSignal(emptyStrategicFitWorkspaceRegions());

export type StrategicFitFindingQueueFilter =
  | { readonly kind: "all" }
  | { readonly kind: "classification"; readonly classification: "forced-diversity" | "intentional-diversity" }
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
