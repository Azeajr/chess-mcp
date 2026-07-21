import { For, Show } from "solid-js";
import type {
  PreflightIssue,
  PreflightIssueCode,
  PreflightIssueKind,
  PreflightIssueSeverity,
  StrategicFitPreflight,
} from "@chess-mcp/chess-tools";

export const PREFLIGHT_CODE_LABELS: Readonly<Record<PreflightIssueCode, string>> = {
  "empty-repertoire": "Empty repertoire",
  "single-route": "Single-route repertoire",
  "illegal-line": "Illegal repertoire line",
  "malformed-data": "Malformed repertoire data",
  "duplicate-branch": "Duplicate editorial branch",
  "transposition-detected": "Transposition detected",
  "shallow-route": "Shallow route evidence",
  "incomplete-route": "Incomplete repertoire route",
  "missing-opening-classification": "Missing opening classification",
  "stale-training-metadata": "Stale training metadata",
  "stale-game-metadata": "Stale game metadata",
  "unsupported-custom-start": "Unsupported custom starting position",
  "missing-repertoire-color": "Missing repertoire color",
  "terminal-tactical-route": "Terminal tactical route",
  "terminal-endgame-route": "Terminal endgame route",
  "insufficient-comparable-positions": "Insufficient comparable evidence",
};

export const PREFLIGHT_KIND_LABELS: Readonly<Record<PreflightIssueKind, string>> = {
  error: "Input error",
  warning: "Input warning",
  "evidence-limitation": "Evidence limitation",
};

export const PREFLIGHT_SEVERITY_LABELS: Readonly<Record<PreflightIssueSeverity, string>> = {
  blocking: "Blocking",
  degraded: "Degraded evidence",
  informational: "Informational",
};

const MAX_VISIBLE_PATHS = 6;
const MAX_VISIBLE_DETAILS = 8;
const MAX_DETAIL_LENGTH = 220;

function detailText(value: unknown): string {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (serialized === undefined) return String(value);
  return serialized.length <= MAX_DETAIL_LENGTH
    ? serialized
    : `${serialized.slice(0, MAX_DETAIL_LENGTH - 1)}…`;
}

export function boundedPreflightEvidence(issue: PreflightIssue) {
  const paths = issue.affected_source_paths.slice(0, MAX_VISIBLE_PATHS);
  const details = Object.entries(issue.details).slice(0, MAX_VISIBLE_DETAILS)
    .map(([key, value]) => ({ key, value: detailText(value) }));
  return {
    paths,
    hidden_path_count: Math.max(0, issue.affected_source_paths.length - paths.length),
    details,
    hidden_detail_count: Math.max(0, Object.keys(issue.details).length - details.length),
  };
}

export function preflightCountsAreMeaningful(preflight: StrategicFitPreflight): boolean {
  return !preflight.issues.some((issue) =>
    issue.code === "unsupported-custom-start" ||
    issue.code === "malformed-data" ||
    issue.code === "illegal-line"
  );
}

function stateCopy(preflight: StrategicFitPreflight): { label: string; description: string } {
  if (preflight.state === "blocked") {
    return {
      label: "Preflight blocked",
      description: "Input validation stopped the analysis. Only move-order normalization ran; five dependent phases were not run.",
    };
  }
  if (preflight.state === "degraded") {
    return {
      label: "Preflight degraded",
      description: "Analysis completed with evidence limitations. These limits constrain what the report can support.",
    };
  }
  return {
    label: "Preflight ready",
    description: "The repertoire could proceed through deterministic analysis. Preflight confirms analyzability, not strategic quality.",
  };
}

const sourcePath = (path: readonly string[]) => path.length === 0 ? "Repertoire root" : path.join(" ");

function PreflightIssueResult(props: { issue: PreflightIssue }) {
  const evidence = () => boundedPreflightEvidence(props.issue);
  const hasEvidence = () => evidence().paths.length > 0 || evidence().details.length > 0;

  return (
    <li
      class={`strategic-fit-preflight-issue strategic-fit-preflight-${props.issue.severity}`}
      data-preflight-code={props.issue.code}
      data-preflight-kind={props.issue.kind}
      data-preflight-severity={props.issue.severity}
    >
      <div class="strategic-fit-preflight-issue-heading">
        <strong>{PREFLIGHT_CODE_LABELS[props.issue.code]}</strong>
        <span class="strategic-fit-preflight-severity">{PREFLIGHT_SEVERITY_LABELS[props.issue.severity]}</span>
        <span class="strategic-fit-preflight-kind">{PREFLIGHT_KIND_LABELS[props.issue.kind]}</span>
      </div>
      <p>{props.issue.message}</p>
      <Show when={hasEvidence()}>
        <details class="strategic-fit-preflight-evidence">
          <summary>Evidence details</summary>
          <Show when={evidence().paths.length > 0}>
            <div>
              <h3>Affected repertoire paths</h3>
              <ol>
                <For each={evidence().paths}>{(path) => <li><code>{sourcePath(path)}</code></li>}</For>
              </ol>
              <Show when={evidence().hidden_path_count > 0}>
                <p>{evidence().hidden_path_count} additional affected path(s) are retained in the report.</p>
              </Show>
            </div>
          </Show>
          <Show when={evidence().details.length > 0}>
            <dl>
              <For each={evidence().details}>{(entry) => (
                <>
                  <dt>{entry.key.replaceAll("_", " ")}</dt>
                  <dd>{entry.value}</dd>
                </>
              )}</For>
            </dl>
            <Show when={evidence().hidden_detail_count > 0}>
              <p>{evidence().hidden_detail_count} additional detail field(s) are retained in the report.</p>
            </Show>
          </Show>
        </details>
      </Show>
    </li>
  );
}

export default function PreflightResults(props: { preflight: StrategicFitPreflight }) {
  const copy = () => stateCopy(props.preflight);
  const countsMeaningful = () => preflightCountsAreMeaningful(props.preflight);

  return (
    <section
      class={`strategic-fit-preflight strategic-fit-preflight-state-${props.preflight.state}`}
      data-preflight-state={props.preflight.state}
      aria-labelledby="strategic-fit-preflight-title"
    >
      <header>
        <div>
          <span>Input and evidence check</span>
          <h2 id="strategic-fit-preflight-title">Preflight results</h2>
        </div>
        <strong class="strategic-fit-preflight-state-label">{copy().label}</strong>
      </header>
      <p class="strategic-fit-preflight-summary">{copy().description}</p>

      <Show when={countsMeaningful()} fallback={(
        <p class="strategic-fit-preflight-counts-unavailable">
          Route counts are withheld because the input could not be enumerated safely.
        </p>
      )}>
        <dl class="strategic-fit-preflight-counts" aria-label="Preflight route evidence counts">
          <div><dt>Routes found</dt><dd>{props.preflight.route_count}</dd></div>
          <div><dt>Comparable routes</dt><dd>{props.preflight.comparable_route_count}</dd></div>
          <div><dt>Incomplete routes</dt><dd>{props.preflight.incomplete_route_count}</dd></div>
        </dl>
      </Show>

      <Show when={props.preflight.issues.length > 0}>
        <ul class="strategic-fit-preflight-issues" aria-label="Preflight findings">
          <For each={props.preflight.issues}>{(issue) => <PreflightIssueResult issue={issue} />}</For>
        </ul>
      </Show>
    </section>
  );
}
