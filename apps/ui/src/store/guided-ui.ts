import { createSignal } from "solid-js";

// Logical destinations the browser assistant can reveal. They are stable application identifiers,
// independent of breakpoints; ui-adapters/surfaces.ts resolves each to the element that shows it.
export const GUIDED_SURFACES = [
  "document.open",
  "document.save",
  "workspace.board",
  "workspace.moves",
  "analysis.review",
  "analysis.compare",
  "analysis.position",
  "analysis.history",
  "analysis.export",
  "repertoire.audit",
  "repertoire.onlyMoves",
  "repertoire.structures",
  "repertoire.prep",
  "repertoire.export",
  "repertoire.transfer",
  "repertoire.gaps",
  "repertoire.connect",
  "repertoire.shorten",
  "repertoire.extend",
  "repertoire.preview",
  "strategicFit.assessment",
  "strategicFit.review",
  "strategicFit.branch",
  "strategicFit.decision",
  "strategicFit.training",
  "strategicFit.lab",
] as const;
export type GuidedSurface = (typeof GUIDED_SURFACES)[number];
export const isGuidedSurface = (value: unknown): value is GuidedSurface =>
  (GUIDED_SURFACES as readonly unknown[]).includes(value);
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
