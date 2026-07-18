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

export function setStrategicFitWorkspaceRegionState(
  region: StrategicFitWorkspaceStage,
  state: StrategicFitWorkspaceRegionState,
) {
  setStrategicFitWorkspaceRegions((current) => ({ ...current, [region]: { ...state } }));
}
