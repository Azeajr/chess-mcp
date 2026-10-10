import { createSignal } from "solid-js";

export type GuidedSurface = "analysis.review" | "analysis.compare" | "document.open";
export const [comparisonDraft, setComparisonDraftValue] = createSignal("");
export const [comparisonVersion, setComparisonVersion] = createSignal(0);
export const [comparisonOpen, setComparisonOpen] = createSignal(false);
export const [guidedSurface, setGuidedSurface] = createSignal<GuidedSurface | null>(null);
export const [interactionEpoch, setInteractionEpoch] = createSignal(0);
export const [guidedStatus, setGuidedStatus] = createSignal<
  "idle" | "executing" | "paused" | "completed" | "cancelled" | "failed"
>("idle");
export const [guidedPurpose, setGuidedPurpose] = createSignal("");
export const [selectedReview, setSelectedReview] = createSignal<{
  resultId: string;
  ply: number;
} | null>(null);

let interrupt: (() => void) | undefined;
export function registerGuidedInterrupt(handler: () => void) {
  interrupt = handler;
}

export function manualIntervention() {
  setInteractionEpoch((value) => value + 1);
  if (guidedStatus() === "executing") {
    setGuidedStatus("paused");
    setGuidedPurpose("Paused so you can use the controls. Send a message to continue.");
    interrupt?.();
  }
}

export function setComparisonDraft(value: string) {
  setComparisonDraftValue(value);
  setComparisonVersion((version) => version + 1);
}

type Presenter = (surface: GuidedSurface, signal?: AbortSignal) => Promise<boolean>;
let presenter: Presenter | undefined;
export function registerGuidedPresenter(handler: Presenter) {
  presenter = handler;
  return () => {
    if (presenter === handler) presenter = undefined;
  };
}
export async function presentGuidedSurface(surface: GuidedSurface, signal?: AbortSignal) {
  if (signal?.aborted) return false;
  setGuidedSurface(surface);
  return (await presenter?.(surface, signal)) ?? false;
}
