import { For, Show } from "solid-js";
import type { StrategicFinding, StrategicFitAnalysisResult } from "@chess-mcp/chess-tools";
import type { StrategicFitDisplayedResolutionState } from "../../store/strategic-fit-finding-resolutions";
import { buildStrategicFindingStory, findingNeedsDecision } from "./finding-story";

export interface StrategicAssessmentPresentation {
  readonly headline: string;
  readonly explanation: string;
  readonly coverage: string;
  readonly decision_count: number;
  readonly context_count: number;
  readonly gap_count: number;
  readonly focus: readonly StrategicFinding[];
}

const workloadHeadline = (workload: StrategicFitAnalysisResult["summary"]["workload"]): string => {
  if (workload === "low") return "Your repertoire mostly returns to familiar plans";
  if (workload === "moderate") return "Your repertoire mixes several kinds of positions";
  if (workload === "high") return "Your repertoire asks you to learn many different plans";
  return "There is not enough evidence for an overall assessment";
};

function priorityScore(finding: StrategicFinding): number {
  return Math.max(finding.replacement_priority.score, finding.training_priority.score);
}

export function buildStrategicAssessmentPresentation(
  report: StrategicFitAnalysisResult,
  findings: readonly StrategicFinding[],
  resolutionState: (finding: StrategicFinding) => StrategicFitDisplayedResolutionState,
): StrategicAssessmentPresentation {
  const unresolved = findings.filter((finding) => resolutionState(finding) === "unresolved");
  const decisions = unresolved.filter((finding) => findingNeedsDecision(finding, "unresolved"));
  const gaps = unresolved.filter((finding) => buildStrategicFindingStory(finding).kind === "gap");
  const context = unresolved.filter(
    (finding) => buildStrategicFindingStory(finding).kind === "context",
  );
  const reuse = report.summary.metrics.concept_reuse;
  const explanation =
    reuse.state === "unavailable" || reuse.value === null
      ? "The review could not measure how often strategic ideas repeat across the comparable lines."
      : `Across the lines that could be compared, ${Math.round(reuse.value * 100)}% of identified ideas repeat.${reuse.state === "partial" ? " This estimate uses partial coverage." : ""}`;
  return {
    headline: workloadHeadline(report.summary.workload),
    explanation,
    coverage: `${report.preflight.comparable_route_count} of ${report.preflight.route_count} repertoire branches are long enough to compare.${report.preflight.incomplete_route_count > 0 ? ` ${report.preflight.incomplete_route_count} need more moves.` : ""}`,
    decision_count: decisions.length,
    context_count: context.length,
    gap_count: gaps.length,
    focus: [...decisions]
      .sort(
        (left, right) =>
          priorityScore(right) - priorityScore(left) ||
          (right.expected_frequency ?? 0) - (left.expected_frequency ?? 0) ||
          left.finding_id.localeCompare(right.finding_id),
      )
      .slice(0, 3),
  };
}

export default function StrategicAssessment(props: {
  report: StrategicFitAnalysisResult;
  findings: readonly StrategicFinding[];
  resolutionState: (finding: StrategicFinding) => StrategicFitDisplayedResolutionState;
  onReviewAll: () => void;
  onOpenFinding: (findingId: string) => void;
}) {
  const presentation = () =>
    buildStrategicAssessmentPresentation(props.report, props.findings, props.resolutionState);

  return (
    <section class="strategic-fit-assessment" aria-labelledby="strategic-fit-assessment-title">
      <div class="strategic-fit-assessment-lead">
        <span>Repertoire assessment</span>
        <h2 id="strategic-fit-assessment-title">{presentation().headline}</h2>
        <p>{presentation().explanation}</p>
        <p class="strategic-fit-assessment-coverage">{presentation().coverage}</p>
      </div>

      <div class="strategic-fit-assessment-groups" aria-label="What the review found">
        <article data-assessment-kind="choice">
          <strong>{presentation().decision_count}</strong>
          <span>choices to review</span>
          <p>Differences that come from your moves and may add another plan to learn.</p>
        </article>
        <article data-assessment-kind="context">
          <strong>{presentation().context_count}</strong>
          <span>explained differences</span>
          <p>Opponent-forced, intentional, or harmless move-order differences.</p>
        </article>
        <article data-assessment-kind="gap">
          <strong>{presentation().gap_count}</strong>
          <span>lines needing more moves</span>
          <p>Branches that end before the position becomes comparable.</p>
        </article>
      </div>

      <Show
        when={presentation().focus.length > 0}
        fallback={
          <div class="strategic-fit-assessment-clear">
            <strong>No repertoire choice stands out for change.</strong>
            <p>You can still inspect forced differences, transpositions, and incomplete lines.</p>
            <button type="button" onClick={props.onReviewAll}>
              Review all results
            </button>
          </div>
        }
      >
        <div class="strategic-fit-assessment-focus">
          <div>
            <h3>Start with these choices</h3>
            <p>These are the clearest places where your own moves create a different plan.</p>
          </div>
          <ol>
            <For each={presentation().focus}>
              {(finding) => {
                const story = buildStrategicFindingStory(finding);
                return (
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        props.onOpenFinding(finding.finding_id);
                      }}
                    >
                      <span>{finding.opening_scope}</span>
                      <strong>{story.title}</strong>
                      <small>{story.frequency ?? story.control}</small>
                    </button>
                  </li>
                );
              }}
            </For>
          </ol>
          <button
            type="button"
            class="strategic-fit-assessment-all"
            onClick={() => {
              props.onReviewAll();
            }}
          >
            See all results
          </button>
        </div>
      </Show>
    </section>
  );
}
