import type {
  CausalControlLabel,
  StrategicFinding,
  StrategicFitClassification,
} from "@chess-mcp/chess-tools";
import type { StrategicFitDisplayedResolutionState } from "../../store/strategic-fit-finding-resolutions";

export type StrategicFindingKind = "choice" | "context" | "gap";

const TITLES: Readonly<Record<StrategicFitClassification, string>> = {
  "genuine-inconsistency": "This line asks you to learn a different plan",
  "forced-diversity": "Your opponent steers this line into a different position",
  "intentional-diversity": "This line is a deliberate exception",
  "productive-diversity": "This variation adds useful variety",
  "mixed-strategic-profile": "This branch can lead to several kinds of positions",
  uncertain: "This line ends before there is enough to compare",
  "data-quality-issue": "This branch could not be compared reliably",
  "transpositional-equivalence": "These move orders reach the same position",
};

const SITUATIONS: Readonly<Record<StrategicFitClassification, string>> = {
  "genuine-inconsistency":
    "Its recurring structure and plans differ from the rest of the comparable repertoire.",
  "forced-diversity":
    "The different position comes mainly from an opponent choice that your repertoire needs to cover.",
  "intentional-diversity":
    "This branch adds a different plan that you previously chose to keep in the repertoire.",
  "productive-diversity":
    "This branch adds a different plan and the report found a practical reason for keeping it.",
  "mixed-strategic-profile":
    "The available lines support more than one kind of middlegame instead of one clear typical plan.",
  uncertain:
    "The line stops before the position settles enough to compare its structure and plans.",
  "data-quality-issue":
    "Missing or conflicting line data prevents a dependable comparison with the rest of the repertoire.",
  "transpositional-equivalence":
    "The move order is different, but it reaches a position already covered elsewhere in the repertoire.",
};

const CONTROL_COPY: Readonly<Record<CausalControlLabel, string>> = {
  "mostly-player-controlled": "This difference mostly follows from moves you choose.",
  "mostly-opponent-forced": "Your opponent mostly decides whether this position appears.",
  "shared-or-uncertain": "Choices by both players contribute to the difference.",
  unknown: "The available lines do not show who controls the difference.",
};

export interface StrategicFindingStory {
  readonly title: string;
  readonly situation: string;
  readonly control: string;
  readonly next_step: string;
  readonly kind: StrategicFindingKind;
  readonly action_label: string;
  readonly frequency: string | null;
  readonly uncertainty: string | null;
}

function findingKind(finding: StrategicFinding): StrategicFindingKind {
  if (
    finding.classification === "uncertain" ||
    finding.classification === "data-quality-issue" ||
    finding.replacement_priority.label === "insufficient-evidence" ||
    finding.training_priority.label === "insufficient-evidence"
  ) {
    return "gap";
  }
  if (
    finding.classification === "genuine-inconsistency" ||
    (finding.classification === "mixed-strategic-profile" &&
      finding.evidence.causality.label === "mostly-player-controlled") ||
    finding.replacement_priority.label === "review-now" ||
    finding.replacement_priority.label === "review-later" ||
    finding.training_priority.label === "review-now" ||
    finding.training_priority.label === "review-later"
  ) {
    return "choice";
  }
  return "context";
}

function nextStep(finding: StrategicFinding, kind: StrategicFindingKind): string {
  if (kind === "gap") return "Add more moves to this line, then run the review again.";
  if (finding.classification === "transpositional-equivalence") {
    return "No repertoire change is needed for this move-order difference.";
  }
  if (finding.evidence.causality.label === "mostly-opponent-forced") {
    return "Keep the coverage. Train this exception if the position still feels unfamiliar.";
  }
  if (
    finding.classification === "intentional-diversity" ||
    finding.classification === "productive-diversity"
  ) {
    return "Keep it if the extra option is worth the additional plan you need to remember.";
  }
  if (kind === "choice") {
    return "Decide whether to keep and train this plan or compare it with a more familiar line.";
  }
  return "Review the line in context before deciding whether it needs any action.";
}

function actionLabel(
  kind: StrategicFindingKind,
  classification: StrategicFitClassification,
): string {
  if (kind === "gap") return "Needs more moves";
  if (classification === "transpositional-equivalence") return "No action needed";
  if (kind === "choice") return "Review this choice";
  return "Suggested: keep as is";
}

function expectedFrequency(value: number | null): string | null {
  if (value === null) return null;
  const games = Math.round(value * 100);
  if (games < 1) return "Rare in expected games";
  return `About ${games} in 100 expected games`;
}

export function buildStrategicFindingStory(finding: StrategicFinding): StrategicFindingStory {
  const kind = findingKind(finding);
  return {
    title: TITLES[finding.classification],
    situation: SITUATIONS[finding.classification],
    control: CONTROL_COPY[finding.evidence.causality.label],
    next_step: nextStep(finding, kind),
    kind,
    action_label: actionLabel(kind, finding.classification),
    frequency: expectedFrequency(finding.expected_frequency),
    uncertainty:
      finding.confidence.label === "low" && kind !== "gap"
        ? "Treat this conclusion as tentative because the supporting lines are limited."
        : null,
  };
}

export function findingNeedsDecision(
  finding: StrategicFinding,
  resolution: StrategicFitDisplayedResolutionState,
): boolean {
  return resolution === "unresolved" && buildStrategicFindingStory(finding).kind === "choice";
}
