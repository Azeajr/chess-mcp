import { modalDepth, backgroundSuspended } from "../../store/shortcuts";
import {
  mobileTab,
  settingsOpen,
  setMobileTab,
  setStrategicFitWorkspaceOpen,
  setStrategicFitWorkspaceStage,
  strategicFitWorkspaceOpen,
  type MobileTab,
  type StrategicFitWorkspaceStage,
} from "../../store/ui";
import { setComparisonOpen, type GuidedSurface } from "../../store/guided-ui";
import { replacementLabSnapshot } from "../../store/strategic-fit-replacement";
import { pendingDocumentClose, pendingLoad } from "../../store/files";
import { recoverDialogOpen } from "../../store/persist";
import { pendingPromo } from "../../store/promotion";

type SurfaceScope = "app" | "strategicFit" | "lab";

interface SurfaceRoute {
  readonly label: string;
  readonly scope: SurfaceScope;
  /** Tried in order; the first element that renders is the destination. */
  readonly selectors: readonly string[];
  readonly tab?: MobileTab;
  readonly stage?: StrategicFitWorkspaceStage;
}

const guided = (surface: GuidedSurface) => `[data-guided-surface="${surface}"]`;
const SETUP = ".strategic-fit-profile-setup";

export const SURFACE_ROUTES: Readonly<Record<GuidedSurface, SurfaceRoute>> = {
  "document.open": {
    label: "Open PGN",
    scope: "app",
    selectors: [`.assistant-controls ${guided("document.open")}`],
  },
  "document.save": {
    label: "Save",
    scope: "app",
    selectors: [`.assistant-controls ${guided("document.save")}`],
  },
  "workspace.board": { label: "Board", scope: "app", selectors: [guided("workspace.board")] },
  "workspace.moves": {
    label: "Moves",
    scope: "app",
    selectors: ["#mobile-panel-moves"],
    tab: "moves",
  },
  "analysis.review": {
    label: "Review game",
    scope: "app",
    selectors: [guided("analysis.review")],
    tab: "analysis",
  },
  "analysis.compare": {
    label: "Compare moves and position tools",
    scope: "app",
    selectors: [guided("analysis.compare")],
    tab: "analysis",
  },
  "analysis.position": {
    label: "Compare moves and position tools",
    scope: "app",
    selectors: [guided("analysis.compare")],
    tab: "analysis",
  },
  "analysis.history": {
    label: "Prepare · Import my games",
    scope: "app",
    selectors: [guided("analysis.history")],
    tab: "analysis",
  },
  "analysis.export": {
    label: "Export annotated game",
    scope: "app",
    selectors: [guided("analysis.export")],
    tab: "analysis",
  },
  "repertoire.audit": {
    label: "Prescribed-move audit",
    scope: "app",
    selectors: [guided("repertoire.audit")],
    tab: "analysis",
  },
  "repertoire.onlyMoves": {
    label: "Only moves & drills",
    scope: "app",
    selectors: [guided("repertoire.onlyMoves")],
    tab: "analysis",
  },
  "repertoire.structures": {
    label: "Structure search",
    scope: "app",
    selectors: [guided("repertoire.structures")],
    tab: "analysis",
  },
  "repertoire.prep": {
    label: "Opponent preparation",
    scope: "app",
    selectors: [guided("repertoire.prep")],
    tab: "analysis",
  },
  "repertoire.export": {
    label: "Annotated repertoire",
    scope: "app",
    selectors: [guided("repertoire.export")],
    tab: "analysis",
  },
  "repertoire.transfer": {
    label: "Strategic Fit portability",
    scope: "app",
    selectors: [guided("repertoire.transfer")],
    tab: "analysis",
  },
  "repertoire.gaps": {
    label: "Gaps",
    scope: "app",
    selectors: [guided("repertoire.gaps")],
    tab: "analysis",
  },
  "repertoire.connect": {
    label: "Connect",
    scope: "app",
    selectors: [guided("repertoire.connect")],
    tab: "analysis",
  },
  "repertoire.shorten": {
    label: "Shorten",
    scope: "app",
    selectors: [guided("repertoire.shorten")],
    tab: "analysis",
  },
  "repertoire.extend": {
    label: "Extend here",
    scope: "app",
    selectors: [guided("repertoire.extend")],
    tab: "analysis",
  },
  "repertoire.preview": {
    label: "Staged line",
    scope: "app",
    selectors: [".rep-panel > .rep-preview", ".rep-flag .rep-preview"],
    tab: "analysis",
  },
  "strategicFit.assessment": {
    label: "Strategic Fit · Assessment",
    scope: "strategicFit",
    selectors: ["#strategic-fit-pane-overview", SETUP],
    stage: "overview",
  },
  "strategicFit.review": {
    label: "Strategic Fit · Review",
    scope: "strategicFit",
    selectors: ["#strategic-fit-pane-findings", SETUP],
    stage: "findings",
  },
  "strategicFit.branch": {
    label: "Strategic Fit · Branch",
    scope: "strategicFit",
    selectors: ["#strategic-fit-pane-evidence", SETUP],
    stage: "evidence",
  },
  "strategicFit.decision": {
    label: "Strategic Fit · What do you want to do?",
    scope: "strategicFit",
    selectors: ["[data-prepared-decision]", "#strategic-fit-inline-actions", SETUP],
    stage: "evidence",
  },
  "strategicFit.training": {
    label: "Strategic Fit · Train this exception",
    scope: "strategicFit",
    selectors: [".strategic-fit-training", SETUP],
    stage: "evidence",
  },
  "strategicFit.lab": {
    label: "Replacement Lab",
    scope: "lab",
    selectors: [".replacement-lab-inner"],
  },
};

export type ActiveDialog =
  | "replacement-lab"
  | "strategic-fit"
  | "settings"
  | "color-picker"
  | "document-close"
  | "recovery"
  | "promotion"
  | "other"
  | null;

// The lab renders inside the Strategic Fit overlay. Closing the overlay unmounts it but keeps its
// candidates and staged review in the store, so it reappears intact when the overlay reopens.
const labRendered = () => strategicFitWorkspaceOpen() && replacementLabSnapshot().open;

/** Names the topmost modal, so a blocked receipt can say which dialog is in the way. */
export function activeDialog(): ActiveDialog {
  if (!backgroundSuspended()) return null;
  const known =
    (strategicFitWorkspaceOpen() ? 1 : 0) +
    (labRendered() ? 1 : 0) +
    (settingsOpen() ? 1 : 0) +
    (pendingLoad() ? 1 : 0) +
    (pendingDocumentClose() ? 1 : 0) +
    (recoverDialogOpen() ? 1 : 0) +
    (pendingPromo() ? 1 : 0);
  if (modalDepth() > known) return "other";
  if (pendingDocumentClose()) return "document-close";
  if (pendingLoad()) return "color-picker";
  if (pendingPromo()) return "promotion";
  if (recoverDialogOpen()) return "recovery";
  if (settingsOpen()) return "settings";
  if (labRendered()) return "replacement-lab";
  if (strategicFitWorkspaceOpen()) return "strategic-fit";
  return "other";
}

/**
 * A dialog the assistant may not see past or dismiss: the user decides there. Strategic Fit is
 * not one of them, because leaving it keeps its state; but its panes stay inert under an open lab.
 */
export function blockingDialogFor(surface: GuidedSurface): ActiveDialog {
  const dialog = activeDialog();
  const scope = SURFACE_ROUTES[surface].scope;
  if (dialog === null || dialog === "strategic-fit") return null;
  if (dialog === "replacement-lab") return scope === "strategicFit" ? dialog : null;
  return dialog;
}

/** Where a finished workflow shows its outcome, when that is not the control that started it. */
export const WORKFLOW_RESULT_SELECTORS: Readonly<Partial<Record<string, string>>> = {
  import_history: "[data-import-notice]",
  export_game: "[data-export-command='export_annotated_pgn']",
  export_repertoire: "[data-guided-surface='repertoire.export'] [data-export-state]",
  lab_stage: ".replacement-change-review",
};

const frame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });

/** Scrolls a workflow's rendered outcome into view; false when nothing rendered there. */
export async function revealWorkflowResult(workflow: string): Promise<boolean | null> {
  const selector = WORKFLOW_RESULT_SELECTORS[workflow];
  if (!selector) return null;
  await frame();
  const target = document.querySelector<HTMLElement>(selector);
  if (!target?.getClientRects().length) return false;
  target.scrollIntoView({ block: "nearest" });
  return true;
}

/**
 * Opens and reveals a destination in the real interface, then reports whether it rendered.
 * Leaving Strategic Fit only closes the overlay; its stage, queue, selection and any open lab stay
 * in their stores. The Replacement Lab itself is never closed here: that discards its candidates.
 */
export async function presentSurfaceInDocument(
  surface: GuidedSurface,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted || blockingDialogFor(surface) !== null) return false;
  const route = SURFACE_ROUTES[surface];
  if (route.scope === "app" && strategicFitWorkspaceOpen()) setStrategicFitWorkspaceOpen(false);
  if (route.scope === "strategicFit") {
    if (!strategicFitWorkspaceOpen()) setStrategicFitWorkspaceOpen(true);
    if (route.stage) setStrategicFitWorkspaceStage(route.stage);
  }
  if (route.scope === "lab") {
    if (!replacementLabSnapshot().open) return false;
    if (!strategicFitWorkspaceOpen()) setStrategicFitWorkspaceOpen(true);
  }
  if (route.tab && mobileTab() !== route.tab) setMobileTab(route.tab);
  if (surface === "analysis.compare" || surface === "analysis.position") setComparisonOpen(true);
  await frame();
  await frame();
  if (signal?.aborted || blockingDialogFor(surface) !== null) return false;
  for (const selector of route.selectors) {
    const target = document.querySelector<HTMLElement>(selector);
    if (!target) continue;
    if (target instanceof HTMLDetailsElement) target.open = true;
    for (let parent = target.parentElement; parent; parent = parent.parentElement)
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    if (!target.getClientRects().length) continue;
    target.scrollIntoView({ block: "nearest" });
    return true;
  }
  return false;
}
