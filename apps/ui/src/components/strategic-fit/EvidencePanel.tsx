import { For, Show } from "solid-js";
import {
  type Color,
  type PreflightIssue,
  type StrategicFinding,
  type StrategicFitProfileMode,
  type StrategicFitSourceKind,
  type StrategicFitSourceProvenance,
} from "@chess-mcp/chess-tools";
import ConceptComparison, {
  buildConceptComparisonPresentation,
} from "./ConceptComparison";
import ConfidenceDetails, {
  ConfidenceExpertValues,
} from "./ConfidenceDetails";

const PROFILE_LABELS: Readonly<Record<StrategicFitProfileMode, string>> = {
  "familiar-plans": "Familiar plans",
  balanced: "Balanced",
  versatile: "Versatile",
  custom: "Custom",
};

const SOURCE_KIND_LABELS: Readonly<Record<StrategicFitSourceKind, string>> = {
  "deterministic-core": "Deterministic analysis",
  repertoire: "Repertoire content",
  "user-profile": "Strategic Fit profile",
  "repertoire-annotation": "Repertoire annotation",
  "opening-taxonomy": "Opening classification",
  "structure-classifier": "Structure classification",
  "concept-classifier": "Concept classification",
  "opening-explorer": "Opening explorer",
  "personal-history": "Personal game history",
  "training-metadata": "Training metadata",
  engine: "Engine evidence",
  "ai-explanation": "AI explanation",
};

const SOURCE_STATE_LABELS = {
  available: "Available",
  partial: "Partial",
  unavailable: "Unavailable",
  stale: "Stale",
} as const;

const formatNumber = (value: number, maximumFractionDigits = 2): string =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);

const formatPercent = (value: number): string => `${formatNumber(value * 100, 1)}%`;

export interface StrategicFitObjectivePresentation {
  readonly state: "unavailable" | "partial" | "available";
  readonly state_label: string;
  readonly verdict: string;
  readonly reason: string | null;
  readonly repertoire_pov_label: string;
  readonly repertoire_pov_value: string;
  readonly repertoire_pov_explanation: string;
  readonly loss_from_best: string;
  readonly engine_depth: string;
  readonly engine_lines: string;
  readonly database_performance: string;
  readonly theoretical_status: string;
}

export function buildObjectivePresentation(
  finding: StrategicFinding,
  repertoireColor: Color,
): StrategicFitObjectivePresentation {
  const objective = finding.objective_quality;
  const side = repertoireColor === "white" ? "White" : "Black";
  const evidence = objective.state === "available"
    ? "Verified objective evidence"
    : objective.state === "partial"
      ? "Partial objective evidence"
      : "Objective evidence unavailable";
  const verdict = objective.state === "unavailable" || objective.verdict === "unknown"
    ? "No objective verdict is available for this repertoire line."
    : objective.verdict === "sound"
      ? `The line is objectively sound for the ${side} repertoire.`
      : `The line is objectively dubious for the ${side} repertoire.`;
  const cp = objective.repertoire_pov_cp;
  const cpValue = cp === null ? "Unavailable" : `${cp >= 0 ? "+" : ""}${formatNumber(cp, 0)} cp`;
  return {
    state: objective.state,
    state_label: evidence,
    verdict,
    reason: objective.reason,
    repertoire_pov_label: `${side} repertoire POV evaluation`,
    repertoire_pov_value: cpValue,
    repertoire_pov_explanation: cp === null
      ? `No ${side} repertoire-POV engine score is present in this report.`
      : `Positive values favor the ${side} repertoire; negative values favor its opponent.`,
    loss_from_best: objective.loss_from_best_cp === null
      ? "Unavailable"
      : `${formatNumber(objective.loss_from_best_cp, 0)} cp`,
    engine_depth: objective.engine_depth === null
      ? "Unavailable"
      : formatNumber(objective.engine_depth, 0),
    engine_lines: objective.engine_lines === null
      ? "Unavailable"
      : formatNumber(objective.engine_lines, 0),
    database_performance: objective.database_performance === null
      ? "Unavailable"
      : formatNumber(objective.database_performance, 3),
    theoretical_status: objective.theoretical_status ?? "Unavailable",
  };
}

interface EvidenceSourcePresentation {
  readonly group: "Finding report" | "Comparison evidence" | "Objective quality";
  readonly source: StrategicFitSourceProvenance;
  readonly kind_label: string;
  readonly state_label: string;
}

export interface StrategicFitEvidencePresentation {
  readonly effective_branches: string;
  readonly weighted_reference_games: string;
  readonly structural_coverage: string;
  readonly analysis_window: string;
  readonly taxonomy_version: string;
  readonly profile: string;
  readonly paths: readonly string[];
  readonly limitations: readonly string[];
  readonly sources: readonly EvidenceSourcePresentation[];
  readonly objective: StrategicFitObjectivePresentation;
}

function sourcePresentations(finding: StrategicFinding): EvidenceSourcePresentation[] {
  return [
    ...finding.provenance.sources.map((source) => ({
      group: "Finding report" as const,
      source,
    })),
    ...finding.evidence.provenance.map((source) => ({
      group: "Comparison evidence" as const,
      source,
    })),
    ...finding.objective_quality.provenance.map((source) => ({
      group: "Objective quality" as const,
      source,
    })),
  ].map((entry) => ({
    ...entry,
    kind_label: SOURCE_KIND_LABELS[entry.source.kind],
    state_label: SOURCE_STATE_LABELS[entry.source.state],
  }));
}

export function buildEvidencePresentation(
  finding: StrategicFinding,
  preflightIssues: readonly PreflightIssue[],
  repertoireColor: Color,
): StrategicFitEvidencePresentation {
  const basis = finding.evidence.comparison_basis;
  const sources = sourcePresentations(finding);
  const limitations: string[] = [];
  if (finding.evidence.dimensions.length === 0) {
    limitations.push("Comparable typical-versus-branch dimensions are unavailable.");
  }
  for (const dimension of finding.evidence.dimensions) {
    if (dimension.typical_value === null || dimension.affected_value === null) {
      limitations.push(`One side of ${dimension.dimension_id} is unavailable; it is not shown as zero.`);
    }
  }
  if (basis.weighted_reference_games === null) {
    limitations.push("Weighted reference-game evidence is unavailable.");
  }
  if (basis.analysis_window === null) limitations.push("A comparable analysis window is unavailable.");
  if (basis.taxonomy_version === null) limitations.push("Opening taxonomy version is unavailable.");
  for (const issueId of finding.evidence.data_quality_issue_ids) {
    const issue = preflightIssues.find((candidate) => candidate.issue_id === issueId);
    limitations.push(issue?.message ?? "The report records a data-quality limitation for this comparison.");
  }
  for (const entry of sources) {
    if (entry.source.state === "available") continue;
    limitations.push(entry.source.reason ?? `${entry.kind_label} is ${entry.state_label.toLowerCase()}.`);
  }
  if (finding.objective_quality.state !== "available" && finding.objective_quality.reason) {
    limitations.push(finding.objective_quality.reason);
  }
  return {
    effective_branches: formatNumber(basis.effective_branches),
    weighted_reference_games: basis.weighted_reference_games === null
      ? "Unavailable"
      : formatNumber(basis.weighted_reference_games),
    structural_coverage: formatPercent(basis.structural_classification_coverage),
    analysis_window: basis.analysis_window === null
      ? "Unavailable"
      : `Plies ${basis.analysis_window[0]}–${basis.analysis_window[1]}`,
    taxonomy_version: basis.taxonomy_version ?? "Unavailable",
    profile: PROFILE_LABELS[basis.profile_mode],
    paths: finding.references.source_san_paths.map((path) =>
      path.length === 0 ? "Start position" : path.join(" ")
    ),
    limitations: [...new Set(limitations)],
    sources,
    objective: buildObjectivePresentation(finding, repertoireColor),
  };
}

export default function EvidencePanel(props: {
  finding: StrategicFinding;
  preflightIssues: readonly PreflightIssue[];
  repertoireColor: Color;
}) {
  const presentation = () => buildEvidencePresentation(
    props.finding,
    props.preflightIssues,
    props.repertoireColor,
  );
  const comparison = () => buildConceptComparisonPresentation(props.finding);
  const listedContributionTotal = () => {
    const total = comparison().reconciliation.listed_total;
    return total === null ? "Unavailable" : formatNumber(total, 6);
  };
  return (
    <article
      class="strategic-fit-evidence"
      aria-label={`Evidence for ${props.finding.plain_language_category}`}
      data-evidence-finding-id={props.finding.finding_id}
    >
      <header class="strategic-fit-evidence-header">
        <span>Selected finding</span>
        <h3>{props.finding.plain_language_category}</h3>
        <p>{props.finding.opening_scope} · {props.finding.affected_line_summary}</p>
      </header>

      <ConceptComparison finding={props.finding} />

      <section class="strategic-fit-comparison-basis" aria-labelledby="strategic-fit-basis-title">
        <h4 id="strategic-fit-basis-title">What this comparison is based on</h4>
        <dl>
          <div><dt>Effective branches</dt><dd>{presentation().effective_branches}</dd></div>
          <div><dt>Weighted reference games</dt><dd>{presentation().weighted_reference_games}</dd></div>
          <div><dt>Structural coverage</dt><dd>{presentation().structural_coverage}</dd></div>
          <div><dt>Analysis window</dt><dd>{presentation().analysis_window}</dd></div>
          <div><dt>Opening taxonomy</dt><dd>{presentation().taxonomy_version}</dd></div>
          <div><dt>Review profile</dt><dd>{presentation().profile}</dd></div>
        </dl>
      </section>

      <ConfidenceDetails confidence={props.finding.confidence} />

      <section
        class="strategic-fit-objective"
        aria-labelledby="strategic-fit-objective-title"
        data-objective-state={presentation().objective.state}
      >
        <h4 id="strategic-fit-objective-title">Objective quality</h4>
        <strong>{presentation().objective.state_label}</strong>
        <p>{presentation().objective.verdict}</p>
        <Show when={presentation().objective.reason}>
          {(reason) => <p class="strategic-fit-evidence-reason">{reason()}</p>}
        </Show>
      </section>

      <section class="strategic-fit-evidence-paths" aria-labelledby="strategic-fit-paths-title">
        <h4 id="strategic-fit-paths-title">Affected source lines</h4>
        <Show when={presentation().paths.length > 0} fallback={(
          <p class="strategic-fit-evidence-unavailable">No source SAN path is available.</p>
        )}>
          <ol>
            <For each={presentation().paths}>{(path) => <li><code>{path}</code></li>}</For>
          </ol>
        </Show>
      </section>

      <section class="strategic-fit-data-quality" aria-labelledby="strategic-fit-quality-title">
        <h4 id="strategic-fit-quality-title">Evidence limitations</h4>
        <Show when={presentation().limitations.length > 0} fallback={(
          <p>No data-quality limitation is recorded for this comparison.</p>
        )}>
          <ul>
            <For each={presentation().limitations}>{(limitation) => <li>{limitation}</li>}</For>
          </ul>
        </Show>
      </section>

      <section class="strategic-fit-evidence-sources" aria-labelledby="strategic-fit-sources-title">
        <h4 id="strategic-fit-sources-title">Evidence sources</h4>
        <Show when={presentation().sources.length > 0} fallback={(
          <p class="strategic-fit-evidence-unavailable">No source provenance is available.</p>
        )}>
          <ul>
            <For each={presentation().sources}>{(entry) => (
              <li data-source-state={entry.source.state}>
                <span>{entry.group}</span>
                <strong>{entry.kind_label}</strong>
                <em>{entry.state_label}</em>
                <Show when={entry.source.reason}><p>{entry.source.reason}</p></Show>
              </li>
            )}</For>
          </ul>
        </Show>
      </section>

      <details class="strategic-fit-evidence-expert">
        <summary>Expert evidence values and provenance</summary>
        <div>
          <ConfidenceExpertValues confidence={props.finding.confidence} />

          <section aria-labelledby="strategic-fit-contribution-values-title">
            <h5 id="strategic-fit-contribution-values-title">Raw comparison contributions</h5>
            <p>
              Listed total: {listedContributionTotal()}. Report strategic
              distance: {formatNumber(comparison().reconciliation.report_distance, 6)}.
            </p>
            <ul>
              <For each={comparison().dimensions}>{(dimension) => (
                <li>
                  <strong>{dimension.dimension_id}</strong>: contribution {formatNumber(
                    dimension.contribution,
                    6,
                  )}; typical <code>{dimension.raw_typical}</code>; affected <code>{dimension.raw_affected}</code>.
                  <span>{dimension.explanation}</span>
                </li>
              )}</For>
            </ul>
          </section>

          <section aria-labelledby="strategic-fit-objective-values-title">
            <h5 id="strategic-fit-objective-values-title">Objective values</h5>
            <dl>
              <dt>{presentation().objective.repertoire_pov_label}</dt>
              <dd>{presentation().objective.repertoire_pov_value}. {presentation().objective.repertoire_pov_explanation}</dd>
              <dt>Loss from best for repertoire side</dt><dd>{presentation().objective.loss_from_best}</dd>
              <dt>Engine depth</dt><dd>{presentation().objective.engine_depth}</dd>
              <dt>Engine lines</dt><dd>{presentation().objective.engine_lines}</dd>
              <dt>Database performance</dt><dd>{presentation().objective.database_performance}</dd>
              <dt>Theoretical status</dt><dd>{presentation().objective.theoretical_status}</dd>
            </dl>
          </section>

          <section aria-labelledby="strategic-fit-reference-values-title">
            <h5 id="strategic-fit-reference-values-title">Semantic references</h5>
            <dl>
              <dt>Finding</dt><dd><code>{props.finding.finding_id}</code></dd>
              <dt>Semantic finding</dt><dd><code>{props.finding.semantic_finding_id}</code></dd>
              <dt>Positions</dt><dd><code>{props.finding.references.position_ids.join(", ") || "None"}</code></dd>
              <dt>Decisions</dt><dd><code>{props.finding.references.decision_ids.join(", ") || "None"}</code></dd>
              <dt>Routes</dt><dd><code>{props.finding.references.route_ids.join(", ") || "None"}</code></dd>
              <dt>Data-quality issue IDs</dt>
              <dd><code>{props.finding.evidence.data_quality_issue_ids.join(", ") || "None"}</code></dd>
            </dl>
          </section>

          <section aria-labelledby="strategic-fit-provenance-values-title">
            <h5 id="strategic-fit-provenance-values-title">Exact provenance</h5>
            <p>
              Report revision <code>{props.finding.provenance.repertoire_revision}</code>; generated
              at <code>{props.finding.provenance.generated_at}</code>; deterministic: {props.finding.provenance.deterministic ? "yes" : "no"}.
            </p>
            <ul>
              <For each={presentation().sources}>{(entry) => (
                <li>
                  <strong>{entry.group}: {entry.source.source_id}</strong>
                  <span>kind {entry.source.kind}; state {entry.source.state}; version {entry.source.version ?? "unavailable"}; snapshot {entry.source.snapshot ?? "unavailable"}; reason {entry.source.reason ?? "none"}.</span>
                </li>
              )}</For>
            </ul>
          </section>
        </div>
      </details>
    </article>
  );
}
