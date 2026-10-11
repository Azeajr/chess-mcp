import type { GuidedSurface } from "../../store/guided-ui";

// Closed vocabularies for the browser assistant's UI actions. This module has no runtime imports so
// the tool schema can be built without loading the stores the adapters operate.

export const WORKFLOWS = {
  review: "analysis.review",
  compare: "analysis.compare",
  evaluate: "analysis.position",
  tablebase: "analysis.position",
  popularity: "analysis.position",
  import_history: "analysis.history",
  compare_history: "analysis.history",
  export_game: "analysis.export",
  audit: "repertoire.audit",
  only_moves: "repertoire.onlyMoves",
  structures: "repertoire.structures",
  prep: "repertoire.prep",
  export_repertoire: "repertoire.export",
  export_strategic_fit_metadata: "repertoire.transfer",
  export_strategic_fit_intent: "repertoire.transfer",
  gaps: "repertoire.gaps",
  gaps_next: "repertoire.gaps",
  gap_fill: "repertoire.gaps",
  connect: "repertoire.connect",
  shorten: "repertoire.shorten",
  extend: "repertoire.extend",
  strategic_fit_analyze: "strategicFit.assessment",
  lab_open: "strategicFit.decision",
  lab_generate: "strategicFit.lab",
  lab_stage: "strategicFit.lab",
  open_drill: "strategicFit.training",
} as const satisfies Record<string, GuidedSurface>;
export type Workflow = keyof typeof WORKFLOWS;
export const isWorkflow = (value: unknown): value is Workflow =>
  typeof value === "string" && Object.hasOwn(WORKFLOWS, value);

export const FORMS = [
  "compare",
  "history",
  "structure",
  "opponent",
  "extend",
  "decision",
  "replacementLab",
] as const;
export type FormId = (typeof FORMS)[number];

export const FORM_SURFACES: Readonly<Record<FormId, GuidedSurface>> = {
  compare: "analysis.compare",
  history: "analysis.history",
  structure: "repertoire.structures",
  opponent: "repertoire.prep",
  extend: "repertoire.extend",
  decision: "strategicFit.decision",
  replacementLab: "strategicFit.lab",
};

export const SETTINGS_SECTIONS = ["general", "engine", "api-key", "lichess-token"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const PUBLIC_SETTINGS = [
  "analysis_depth",
  "cloud_eval",
  "technical_details",
  "chat_workflow",
] as const;
export type PublicSetting = (typeof PUBLIC_SETTINGS)[number];

export const DECISION_STATES = [
  "keep-intentionally",
  "defer",
  "exclude-from-analysis",
  "invalid-comparison",
] as const;

/** The visible control each workflow runs, in the words the interface uses. */
export const WORKFLOW_LABELS: Readonly<Record<Workflow, string>> = {
  review: "Review game",
  compare: "Compare moves",
  evaluate: "Position evaluation",
  tablebase: "Tablebase",
  popularity: "Position popularity",
  import_history: "Import and review games",
  compare_history: "Compare with my history",
  export_game: "Export annotated game",
  audit: "Prescribed-move audit",
  only_moves: "Only moves",
  structures: "Structure search",
  prep: "Opponent preparation",
  export_repertoire: "Generate annotated repertoire",
  export_strategic_fit_metadata: "Export metadata JSON",
  export_strategic_fit_intent: "Export intent PGN",
  gaps: "Gaps scan",
  gaps_next: "Scan next gaps",
  gap_fill: "Choose fill",
  connect: "Connect scan",
  shorten: "Shorten scan",
  extend: "Suggest an extension",
  strategic_fit_analyze: "Strategic Fit analysis",
  lab_open: "Open Replacement Lab",
  lab_generate: "Generate candidates",
  lab_stage: "Stage a candidate's change for review",
  open_drill: "Open the drill",
};
