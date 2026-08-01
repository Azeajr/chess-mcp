import { For, Show, createMemo } from "solid-js";
import { strategicFitPlanSectionLabel } from "@chess-mcp/chess-tools";
import type {
  StrategicFinding,
  StrategicFitAnalysisResult,
  StrategicFitPlanSection,
  StrategicFitPlanSectionKind,
  StrategicFitPortfolioConflict,
  StrategicFitPortfolioConstraint,
  StrategicFitPortfolioElimination,
  StrategicFitPortfolioOption,
  StrategicFitConversationFinding,
  StrategicFitConversationFindingRow,
  StrategicFitConversationFindings,
  StrategicFitConversationPath,
  StrategicFitConversationSummary,
  StrategicFitPreflight,
  StrategicFitReport,
} from "@chess-mcp/chess-tools";
import { actions, currentTree } from "../store/game";
import { acceptStagedEdit, rejectStagedEdit, stagedEdit, stagePreview } from "../store/suggestions";
import {
  acceptStrategicFitProfileProposal,
  rejectStrategicFitProfileProposal,
  strategicFitProfileProposal,
} from "../store/strategic-fit-intent-interview";
import {
  acceptStrategicFitPlanCard,
  rejectStrategicFitPlanCard,
  strategicFitPlanCard,
} from "../store/strategic-fit-plan-synthesis";
import {
  confirmStrategicFitPortfolioConstraints,
  rejectStrategicFitPortfolioConstraints,
  strategicFitPortfolioConstraintSet,
  strategicFitPortfolioSelection,
} from "../store/strategic-fit-portfolio";
import { artifactById, saveArtifact } from "../store/artifacts";

type Data = Record<string, unknown>;
interface Props {
  operation: string;
  content: string | null;
}

const parse = (content: string | null): Data | null => {
  try {
    const value = JSON.parse(content || "null") as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Data) : null;
  } catch {
    return null;
  }
};

function navigateFen(target: string) {
  const tree = currentTree();
  let found: number[] | null = null;
  const walk = (path: number[]) => {
    if (found) return;
    if (tree.fenAt(path) === target) {
      found = path;
      return;
    }
    tree.nodeAt(path).children.forEach((_child, index) => {
      walk([...path, index]);
    });
  };
  walk([]);
  if (found) actions.goto(found);
}

function NavigationRows(props: { data: Data }) {
  const rows = createMemo(() => {
    const out: { label: string; value: string; go: () => void }[] = [];
    const visit = (value: unknown, key = "result") => {
      if (out.length >= 8 || !value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.slice(0, 12).forEach((item, index) => {
          visit(item, `${key} ${index + 1}`);
        });
        return;
      }
      const item = value as Data;
      const path = [item.path, item.san_path, item.variation_path, item.pivot_path].find(
        (candidate) =>
          Array.isArray(candidate) && candidate.every((move) => typeof move === "string"),
      );
      if (path?.length) {
        const indexPath = currentTree().indexPathOfSan(path);
        if (indexPath)
          out.push({
            label: key,
            value: path.join(" "),
            go: () => {
              actions.goto(indexPath);
            },
          });
      } else if (typeof item.fen === "string")
        out.push({
          label: `${key} position`,
          value: item.fen,
          go: () => {
            navigateFen(item.fen as string);
          },
        });
      else if (typeof item.ply === "number") {
        const mainline = Array.from({ length: item.ply }, () => 0);
        try {
          currentTree().nodeAt(mainline);
          out.push({
            label: key,
            value: `Ply ${item.ply}`,
            go: () => {
              actions.goto(mainline);
            },
          });
        } catch {
          /* external game */
        }
      }
      Object.entries(item).forEach(([childKey, child]) => {
        visit(child, childKey.replace(/_/g, " "));
      });
    };
    visit(props.data);
    return out;
  });
  return (
    <For each={rows()}>
      {(row) => (
        <button class="result-nav" onClick={row.go}>
          <span>{row.label}</span>
          <b>{row.value}</b>
        </button>
      )}
    </For>
  );
}

const titleCase = (value: string) =>
  value
    .split(/[-_]/)
    .map((part) => (part ? `${part[0]!.toUpperCase()}${part.slice(1)}` : part))
    .join(" ");

function navigableSanPath(paths: readonly (readonly string[])[]): string[] | null {
  for (const path of paths) {
    if (!path.length) continue;
    const copied = [...path];
    if (currentTree().indexPathOfSan(copied)) return copied;
  }
  return null;
}

function goToSanPath(path: readonly string[]) {
  const indexPath = currentTree().indexPathOfSan([...path]);
  if (indexPath) actions.goto(indexPath);
}

type StrategicFitChatReport = StrategicFitReport &
  Partial<Pick<StrategicFitAnalysisResult, "finding_page">>;

function asStrategicFitReport(data: Data): StrategicFitChatReport | null {
  const nested = data.report;
  const candidate =
    nested && typeof nested === "object" && !Array.isArray(nested) ? (nested as Data) : data;
  return typeof candidate.report_id === "string" &&
    candidate.preflight !== null &&
    typeof candidate.preflight === "object" &&
    candidate.summary !== null &&
    typeof candidate.summary === "object" &&
    Array.isArray(candidate.findings)
    ? (candidate as unknown as StrategicFitChatReport)
    : null;
}

export type StrategicFitChatState = "complete" | "provisional" | "incomplete" | "blocked";

/** Pure report-state projection shared by the card and behavioral tests. */
export function strategicFitChatState(
  preflight: Pick<StrategicFitPreflight, "state">,
  findings: readonly Pick<StrategicFinding, "provisional">[],
): StrategicFitChatState {
  if (preflight.state === "blocked") return "blocked";
  if (preflight.state === "degraded") return "incomplete";
  if (findings.some((finding) => finding.provisional)) return "provisional";
  return "complete";
}

const STRATEGIC_FIT_STATE_LABELS: Record<StrategicFitChatState, string> = {
  complete: "Analysis complete",
  provisional: "Provisional findings",
  incomplete: "Incomplete evidence",
  blocked: "Analysis blocked",
};

function FindingCard(props: { finding: StrategicFinding }) {
  const path = createMemo(() => navigableSanPath(props.finding.references.source_san_paths));
  return (
    <article class="strategic-fit-finding" data-finding-id={props.finding.finding_id}>
      <div class="strategic-fit-finding-head">
        <span class="strategic-fit-category">{props.finding.plain_language_category}</span>
        <span class="strategic-fit-classification">{titleCase(props.finding.classification)}</span>
      </div>
      <div class="strategic-fit-scope">
        {props.finding.opening_scope} · {props.finding.affected_line_summary}
      </div>
      <div class="strategic-fit-explanation">{props.finding.explanation}</div>
      <div class="strategic-fit-signals" aria-label="Finding signals">
        <span>
          Confidence{" "}
          <b>
            {titleCase(props.finding.confidence.label)} {Math.round(props.finding.confidence.score)}
          </b>
        </span>
        <span>
          Difference <b>{titleCase(props.finding.difference.magnitude)}</b>
        </span>
        <span>
          Replace <b>{titleCase(props.finding.replacement_priority.label)}</b>
        </span>
        <span>
          Train <b>{titleCase(props.finding.training_priority.label)}</b>
        </span>
      </div>
      <div class="strategic-fit-reference">
        <code>{props.finding.finding_id}</code>
        <Show when={path()}>
          {(safePath) => (
            <button
              class="result-nav strategic-fit-nav"
              aria-label={`Go to line for ${props.finding.plain_language_category}`}
              onClick={() => {
                goToSanPath(safePath());
              }}
            >
              <span>Go to line</span>
              <b>{safePath().join(" ")}</b>
            </button>
          )}
        </Show>
      </div>
    </article>
  );
}

function StrategicFitResult(props: { report: StrategicFitChatReport }) {
  const state = () => strategicFitChatState(props.report.preflight, props.report.findings);
  const totalFindings = () =>
    props.report.finding_page?.total_count ?? props.report.findings.length;
  const unresolved = () => props.report.summary.unresolved_finding_count;
  const issueCounts = () =>
    props.report.preflight.issues.reduce(
      (counts, issue) => {
        counts[issue.severity]++;
        return counts;
      },
      { blocking: 0, degraded: 0, informational: 0 },
    );
  return (
    <section
      class={`result-card report-card strategic-fit-card strategic-fit-${state()}`}
      data-report-id={props.report.report_id}
      aria-label="Strategic Fit report"
    >
      <div class="result-title">Strategic Fit · {STRATEGIC_FIT_STATE_LABELS[state()]}</div>
      <div class="strategic-fit-report-id">
        Report <code>{props.report.report_id}</code>
      </div>
      <div class="strategic-fit-counts" aria-label="Strategic Fit counts">
        <span>
          {totalFindings()} finding{totalFindings() === 1 ? "" : "s"}
        </span>
        <span>{unresolved()} unresolved</span>
        <span>
          {props.report.preflight.comparable_route_count}/{props.report.preflight.route_count}{" "}
          comparable routes
        </span>
        <span>{props.report.summary.insufficient_evidence_branch_count} incomplete branches</span>
      </div>
      <div class="result-summary strategic-fit-preflight">
        Preflight {titleCase(props.report.preflight.state)} · {issueCounts().blocking} blocking ·{" "}
        {issueCounts().degraded} degraded · {issueCounts().informational} informational
      </div>
      <Show when={props.report.preflight.issues.length > 0}>
        <ul class="strategic-fit-issues">
          <For each={props.report.preflight.issues.slice(0, 3)}>
            {(issue) => (
              <li>
                <b>{titleCase(issue.severity)}</b>: {issue.message}
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show
        when={props.report.findings.length > 0}
        fallback={
          <div class="strategic-fit-empty">
            No findings are available from this report. Review the preflight evidence before drawing
            a conclusion.
          </div>
        }
      >
        <div class="strategic-fit-findings-title">Top findings</div>
        <For each={props.report.findings.slice(0, 3)}>
          {(finding) => <FindingCard finding={finding} />}
        </For>
        <Show when={totalFindings() > Math.min(3, props.report.findings.length)}>
          <div class="strategic-fit-more">
            Showing {Math.min(3, props.report.findings.length)} of {totalFindings()} findings.
          </div>
        </Show>
      </Show>
    </section>
  );
}

type RetrievalProjection =
  | StrategicFitConversationSummary
  | StrategicFitConversationFindings
  | StrategicFitConversationFinding;

function asStrategicFitRetrieval(data: Data): RetrievalProjection | null {
  const retrieval = data.retrieval;
  return retrieval === "strategic-fit-summary" ||
    retrieval === "strategic-fit-findings" ||
    retrieval === "strategic-fit-finding"
    ? (data as unknown as RetrievalProjection)
    : null;
}

function RetrievalPath(props: { path: StrategicFitConversationPath; label: string }) {
  const indexPath = createMemo(() => currentTree().indexPathOfSan([...props.path.san]));
  return (
    <Show when={!props.path.truncated && indexPath()}>
      <button
        class="result-nav strategic-fit-nav"
        aria-label={`Go to line for ${props.label}`}
        onClick={() => {
          goToSanPath(props.path.san);
        }}
      >
        <span>Go to line</span>
        <b>{props.path.san.join(" ")}</b>
      </button>
    </Show>
  );
}

function RetrievalFindingRow(props: { row: StrategicFitConversationFindingRow }) {
  return (
    <article class="strategic-fit-finding" data-finding-id={props.row.finding_id}>
      <div class="strategic-fit-finding-head">
        <span class="strategic-fit-category">{props.row.plain_language_category}</span>
        <span class="strategic-fit-classification">{titleCase(props.row.classification)}</span>
      </div>
      <div class="strategic-fit-scope">
        {props.row.opening_scope} · {props.row.affected_line_summary.text}
      </div>
      <div class="strategic-fit-signals" aria-label="Finding signals">
        <span>
          Confidence{" "}
          <b>
            {titleCase(props.row.confidence.label)} {Math.round(props.row.confidence.score)}
          </b>
        </span>
        <span>
          Difference <b>{titleCase(props.row.difference.magnitude)}</b>
        </span>
        <span>
          Replace <b>{titleCase(props.row.replacement_priority.label)}</b>
        </span>
        <span>
          Train <b>{titleCase(props.row.training_priority.label)}</b>
        </span>
        <span>
          Resolution <b>{titleCase(props.row.resolution_state)}</b>
        </span>
      </div>
      <div class="strategic-fit-reference">
        <code>{props.row.finding_id}</code>
        <For each={props.row.source_san_paths}>
          {(path) => <RetrievalPath path={path} label={props.row.plain_language_category} />}
        </For>
      </div>
    </article>
  );
}

/** Bounded retrieval views. They never claim more evidence than the projection actually carried. */
function StrategicFitRetrievalResult(props: { projection: RetrievalProjection }) {
  return (
    <section
      class="result-card report-card strategic-fit-card strategic-fit-retrieval"
      data-report-id={props.projection.report_id}
      aria-label="Strategic Fit retrieval"
    >
      <Show when={props.projection.retrieval === "strategic-fit-summary" ? props.projection : null}>
        {(summary) => (
          <>
            <div class="result-title">Strategic Fit · Report summary</div>
            <div class="strategic-fit-report-id">
              Report <code>{summary().report_id}</code>
            </div>
            <div class="strategic-fit-counts" aria-label="Strategic Fit counts">
              <span>
                {summary().finding_count} finding{summary().finding_count === 1 ? "" : "s"}
              </span>
              <span>{summary().summary.unresolved_finding_count} unresolved</span>
              <span>
                {summary().preflight.comparable_route_count}/{summary().preflight.route_count}{" "}
                comparable routes
              </span>
              <span>
                {summary().summary.insufficient_evidence_branch_count} incomplete branches
              </span>
            </div>
            <div class="result-summary strategic-fit-preflight">
              Preflight {titleCase(summary().preflight.state)} ·{" "}
              {summary().preflight.issue_counts.blocking} blocking ·{" "}
              {summary().preflight.issue_counts.degraded} degraded ·{" "}
              {summary().preflight.issue_counts.informational} informational
            </div>
            <Show when={summary().preflight.issues.length > 0}>
              <ul class="strategic-fit-issues">
                <For each={summary().preflight.issues}>
                  {(issue) => (
                    <li>
                      <b>{titleCase(issue.severity)}</b>: {issue.message.text}
                    </li>
                  )}
                </For>
                <Show when={summary().preflight.omitted_issue_count > 0}>
                  <li class="strategic-fit-more">
                    {summary().preflight.omitted_issue_count} further issue(s) not shown.
                  </li>
                </Show>
              </ul>
            </Show>
          </>
        )}
      </Show>
      <Show
        when={props.projection.retrieval === "strategic-fit-findings" ? props.projection : null}
      >
        {(page) => (
          <>
            <div class="result-title">
              Strategic Fit · Findings {page().page.offset + 1}–
              {page().page.offset + page().page.returned_count} of {page().page.total_count}
            </div>
            <div class="strategic-fit-report-id">
              Report <code>{page().report_id}</code> · sorted by {titleCase(page().sort)}
            </div>
            <For each={page().findings}>{(row) => <RetrievalFindingRow row={row} />}</For>
            <Show when={page().page.has_more}>
              <div class="strategic-fit-more">More findings remain; request the next page.</div>
            </Show>
          </>
        )}
      </Show>
      <Show when={props.projection.retrieval === "strategic-fit-finding" ? props.projection : null}>
        {(detail) => (
          <>
            <div class="result-title">Strategic Fit · Finding evidence</div>
            <div class="strategic-fit-report-id">
              Report <code>{detail().report_id}</code>
            </div>
            <RetrievalFindingRow row={detail().finding} />
            <div class="strategic-fit-explanation">{detail().finding.explanation.text}</div>
            <div class="result-summary">
              Cohort {detail().finding.evidence.cohort_id} ·{" "}
              {detail().finding.evidence.comparison_basis.effective_branches} effective branches ·
              cause {titleCase(detail().finding.evidence.causality.label)}
            </div>
            <ul class="strategic-fit-issues">
              <For each={detail().finding.evidence.dimensions}>
                {(dimension) => (
                  <li>
                    <b>{titleCase(dimension.dimension_id)}</b>: {dimension.explanation.text}
                  </li>
                )}
              </For>
              <Show when={detail().finding.evidence.omitted_dimension_count > 0}>
                <li class="strategic-fit-more">
                  {detail().finding.evidence.omitted_dimension_count} further dimension(s) not
                  shown.
                </li>
              </Show>
            </ul>
          </>
        )}
      </Show>
    </section>
  );
}

const diffValue = (value: unknown): string => {
  if (value === null) return "not set";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "none";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value);
};

/**
 * A profile proposal is staged, not applied. The card shows the exact before/after for every
 * changed field so the user confirms values rather than a summary of them, and it states plainly
 * that nothing has been saved yet.
 */
function StrategicFitProposalResult(props: { data: Data }) {
  const id = () => String(props.data.proposal_id ?? "");
  const proposal = () => strategicFitProfileProposal(id());
  const entries = createMemo(() =>
    Array.isArray(props.data.diff) ? (props.data.diff as Data[]) : [],
  );
  const status = () => proposal()?.status ?? "unavailable";
  return (
    <section
      class="result-card staged-card strategic-fit-proposal"
      data-proposal-id={id()}
      aria-label="Strategic Fit profile proposal"
    >
      <div class="result-title">
        Proposed profile · {String(props.data.current_mode ?? "")} →{" "}
        {String(props.data.resulting_mode ?? "")}
      </div>
      <Show when={props.data.rationale}>
        <div class="result-summary">{String(props.data.rationale)}</div>
      </Show>
      <Show when={entries().length === 0}>
        <div class="result-summary">
          No setting changes. Accepting only confirms the current values as your explicit intent.
        </div>
      </Show>
      <Show when={entries().length > 0}>
        <table class="strategic-fit-diff">
          <thead>
            <tr>
              <th scope="col">Setting</th>
              <th scope="col">Current</th>
              <th scope="col">Proposed</th>
            </tr>
          </thead>
          <tbody>
            <For each={entries()}>
              {(entry) => (
                <tr data-field={String(entry.field)}>
                  <th scope="row">{String(entry.label ?? entry.field)}</th>
                  <td>{diffValue(entry.current)}</td>
                  <td>
                    <b>{diffValue(entry.proposed)}</b>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
      <div class="result-summary">
        Nothing is saved until you accept. Accepting changes profile preferences only; the
        repertoire is not edited.
      </div>
      <Show when={props.data.confirms_provisional_profile === true}>
        <div class="result-summary">
          Your profile is still the provisional inferred default. Accepting also confirms it as your
          explicit intent.
        </div>
      </Show>
      <Show
        when={status() === "pending"}
        fallback={
          <span class={`result-status ${status()}`}>
            {status() === "stale"
              ? "Profile or document changed — proposal is no longer valid"
              : status() === "unavailable"
                ? "Proposal is not available in this session"
                : status()}
          </span>
        }
      >
        <button class="result-accept" onClick={() => acceptStrategicFitProfileProposal(id())}>
          Accept profile
        </button>
        <button onClick={() => rejectStrategicFitProfileProposal(id())}>Reject</button>
      </Show>
    </section>
  );
}

const countLabel = (count: number, singular: string): string =>
  `${count} ${singular}${count === 1 ? "" : "s"}`;

/**
 * The deterministic basis a plan may rest on. It is shown as evidence, not as a result to act on,
 * and every bound states what it withheld so a shortened list is never read as the whole of it.
 */
function StrategicFitPlanBasisResult(props: { data: Data }) {
  const list = (key: string) => (Array.isArray(props.data[key]) ? (props.data[key] as Data[]) : []);
  const strings = (key: string) =>
    Array.isArray(props.data[key]) ? (props.data[key] as unknown[]).map(String) : [];
  const omitted = (key: string) => (typeof props.data[key] === "number" ? props.data[key] : 0);
  return (
    <section
      class="result-card report-card strategic-fit-plan-basis"
      data-finding-id={String(props.data.finding_id ?? "")}
      aria-label="Strategic Fit plan evidence"
    >
      <div class="result-title">Plan evidence · {String(props.data.finding_id ?? "")}</div>
      <div class="result-summary">
        {countLabel(strings("concept_ids").length, "concept")} ·{" "}
        {countLabel(list("checkpoints").length, "checkpoint")} ·{" "}
        {countLabel(list("drills").length, "drill position")} ·{" "}
        {countLabel(strings("moves").length, "validated move")}
      </div>
      <Show when={strings("concept_ids").length > 0}>
        <div class="result-line">Concepts: {strings("concept_ids").join(", ")}</div>
      </Show>
      <Show when={list("drills").length > 0}>
        <ul class="strategic-fit-plan-drills">
          <For each={list("drills")}>
            {(drill) => (
              <li data-drill-id={String(drill.drill_id)}>
                <b>{String(drill.expected_san)}</b> · {String(drill.source)}
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={props.data.causal_move_san}>
        <div class="result-line">Causal move: {String(props.data.causal_move_san)}</div>
      </Show>
      <Show
        when={
          omitted("omitted_concept_count") +
            omitted("omitted_checkpoint_count") +
            omitted("omitted_drill_count") +
            omitted("omitted_san_path_count") +
            omitted("omitted_move_count") >
          0
        }
      >
        <div class="result-summary strategic-fit-plan-omitted">
          Withheld for size: {omitted("omitted_concept_count")} concepts,{" "}
          {omitted("omitted_checkpoint_count")} checkpoints, {omitted("omitted_drill_count")}{" "}
          drills, {omitted("omitted_san_path_count")} paths, {omitted("omitted_move_count")} moves.
          Withheld evidence exists; it is not absent, and it cannot be cited in a plan.
        </div>
      </Show>
      <div class="result-summary">
        Nothing is saved. A plan written from this evidence is staged for your confirmation.
      </div>
    </section>
  );
}

/**
 * A plan card is staged, not saved. Every section shows the deterministic evidence it rests on, so
 * the user confirms supported content rather than fluent prose.
 */
function StrategicFitPlanCardResult(props: { data: Data }) {
  const id = () => String(props.data.plan_id ?? "");
  const staged = () => strategicFitPlanCard(id());
  const sections = createMemo(() =>
    Array.isArray(props.data.sections)
      ? (props.data.sections as unknown as StrategicFitPlanSection[])
      : [],
  );
  const status = () => staged()?.status ?? "unavailable";
  return (
    <section
      class="result-card staged-card strategic-fit-plan-card"
      data-plan-id={id()}
      data-finding-id={String(props.data.finding_id ?? "")}
      aria-label="Strategic Fit plan card"
    >
      <div class="result-title">Plan · {String(props.data.title ?? "")}</div>
      <For each={sections()}>
        {(section) => (
          <div class="strategic-fit-plan-section" data-section-kind={section.kind}>
            <div class="strategic-fit-plan-section-head">
              {strategicFitPlanSectionLabel(section.kind)}
            </div>
            <div class="strategic-fit-explanation">{section.text}</div>
            <div class="result-summary strategic-fit-plan-support">
              Evidence:{" "}
              {[...section.concept_ids, ...section.checkpoint_ids, ...section.drill_ids].join(", ")}
              <Show when={section.cited_moves.length > 0}>
                {" "}
                · moves {section.cited_moves.join(", ")}
              </Show>
            </div>
          </div>
        )}
      </For>
      <div class="result-summary">
        Nothing is saved until you accept. Accepting records this plan with the training item for
        this finding and does not edit repertoire lines.
      </div>
      <Show
        when={status() === "pending"}
        fallback={
          <span class={`result-status ${status()}`}>
            {status() === "stale"
              ? "Evidence or document changed — plan is no longer valid"
              : status() === "unavailable"
                ? "Plan is not available in this session"
                : status()}
          </span>
        }
      >
        <button class="result-accept" onClick={() => acceptStrategicFitPlanCard(id())}>
          Save plan
        </button>
        <button onClick={() => rejectStrategicFitPlanCard(id())}>Reject</button>
      </Show>
    </section>
  );
}

/**
 * Redesign bounds, shown before they bind anything. A contradiction is presented as the question it
 * is: confirming is the user's decision, and nothing about the bounds is relaxed on their behalf.
 */
function StrategicFitPortfolioConstraintsResult(props: { data: Data }) {
  const id = () => String(props.data.constraint_set_id ?? "");
  const staged = () => strategicFitPortfolioConstraintSet(id());
  const status = () => staged()?.status ?? "unavailable";
  const constraints = createMemo(() =>
    Array.isArray(props.data.constraints)
      ? (props.data.constraints as unknown as StrategicFitPortfolioConstraint[])
      : [],
  );
  const conflicts = createMemo(() =>
    Array.isArray(props.data.conflicts)
      ? (props.data.conflicts as unknown as StrategicFitPortfolioConflict[])
      : [],
  );
  return (
    <section
      class="result-card staged-card strategic-fit-portfolio-constraints"
      data-constraint-set-id={id()}
      aria-label="Strategic Fit redesign bounds"
    >
      <div class="result-title">Redesign bounds</div>
      <Show when={props.data.rationale}>
        <div class="strategic-fit-explanation">{String(props.data.rationale)}</div>
      </Show>
      <ul class="strategic-fit-portfolio-bounds">
        <For each={constraints()}>
          {(constraint) => <li data-constraint-kind={constraint.kind}>{constraint.label}</li>}
        </For>
      </ul>
      <Show when={conflicts().length > 0}>
        <div class="result-summary strategic-fit-portfolio-conflicts">
          {countLabel(conflicts().length, "contradiction")} to settle before these bounds can bind.
        </div>
        <ul class="strategic-fit-portfolio-conflict-list">
          <For each={conflicts()}>
            {(conflict) => (
              <li data-conflict-source={conflict.source}>
                <div>{conflict.explanation}</div>
                <b>{conflict.question}</b>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <div class="result-summary">
        Nothing is bound and no preference was saved. These bounds apply to this redesign only, and
        confirming them changes no profile setting.
      </div>
      <Show
        when={status() === "pending"}
        fallback={
          <span class={`result-status ${status()}`}>
            {status() === "stale"
              ? "Repertoire changed — state the bounds again"
              : status() === "unavailable"
                ? "These bounds are not available in this session"
                : status()}
          </span>
        }
      >
        <button class="result-accept" onClick={() => confirmStrategicFitPortfolioConstraints(id())}>
          Confirm bounds
        </button>
        <button onClick={() => rejectStrategicFitPortfolioConstraints(id())}>Reject</button>
      </Show>
    </section>
  );
}

/**
 * The portfolio the confirmed bounds allow. Each option is one already-generated candidate with the
 * measured value behind every bound; an empty portfolio names the bound that emptied it rather than
 * offering something the evidence never supported.
 */
function StrategicFitPortfolioResultCard(props: { data: Data }) {
  const options = createMemo(() =>
    Array.isArray(props.data.options)
      ? (props.data.options as unknown as StrategicFitPortfolioOption[])
      : [],
  );
  const eliminations = createMemo(() =>
    Array.isArray(props.data.eliminations)
      ? (props.data.eliminations as unknown as StrategicFitPortfolioElimination[])
      : [],
  );
  const binding = createMemo(() =>
    Array.isArray(props.data.binding_constraint_kinds)
      ? (props.data.binding_constraint_kinds as unknown[]).map(String)
      : [],
  );
  const omittedOptions = () => Number(props.data.omitted_option_count ?? 0);
  const omittedEliminations = () => Number(props.data.omitted_elimination_count ?? 0);
  const selection = () => {
    const current = strategicFitPortfolioSelection();
    return current && current.constraint_set_id === String(props.data.constraint_set_id ?? "")
      ? current
      : null;
  };
  return (
    <section
      class="result-card report-card strategic-fit-portfolio"
      data-constraint-set-id={String(props.data.constraint_set_id ?? "")}
      data-portfolio-status={String(props.data.status ?? "")}
      aria-label="Strategic Fit redesign portfolio"
    >
      <div class="result-title">Redesign portfolio · {countLabel(options().length, "option")}</div>
      <div class="strategic-fit-explanation">{String(props.data.explanation ?? "")}</div>
      <For each={options()}>
        {(option) => (
          <div class="strategic-fit-portfolio-option" data-option-id={option.option_id}>
            <div class="strategic-fit-portfolio-option-head">
              <b>{option.action_label}</b> · {option.pareto_status}
              <Show when={option.dominated_by_candidate_ids.length > 0}>
                {" "}
                · dominated by {option.dominated_by_candidate_ids.join(", ")}
              </Show>
            </div>
            <ul class="strategic-fit-portfolio-measurements">
              <For each={option.measurements}>
                {(measurement) => (
                  <li data-measurement-kind={measurement.kind}>
                    {measurement.label}:{" "}
                    {measurement.state === "unavailable"
                      ? `not measured — ${measurement.reason ?? "evidence unavailable"}`
                      : `${measurement.value} ${measurement.unit}`}
                    <Show when={measurement.constraint_value !== null}>
                      {" "}
                      (bound {measurement.constraint_value})
                    </Show>
                  </li>
                )}
              </For>
            </ul>
            <div class="result-summary">
              {countLabel(option.unresolved_risk_count, "unresolved risk")} · evidence{" "}
              {option.evidence_identity}
            </div>
          </div>
        )}
      </For>
      <Show when={omittedOptions() > 0}>
        <div class="result-summary strategic-fit-portfolio-omitted">
          {omittedOptions()} further qualifying option(s) withheld for size. They exist and are not
          excluded; ask for them rather than treating this list as the whole of it.
        </div>
      </Show>
      <Show when={binding().length > 0}>
        <div class="result-summary strategic-fit-portfolio-binding">
          Binding bound(s): {binding().join(", ")}. Moving one of these is what would change the
          result.
        </div>
      </Show>
      <Show when={eliminations().length > 0}>
        <ul class="strategic-fit-portfolio-eliminations">
          <For each={eliminations()}>
            {(elimination) => (
              <li
                data-candidate-id={elimination.candidate_id}
                data-elimination-reason={elimination.reason}
              >
                {elimination.explanation}
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={omittedEliminations() > 0}>
        <div class="result-summary strategic-fit-portfolio-omitted">
          {omittedEliminations()} further exclusion(s) withheld for size.
        </div>
      </Show>
      <div class="result-summary">
        <Show
          when={selection()}
          fallback={
            "Nothing is selected and nothing is applied. Choosing an option stages its existing change set for your confirmation."
          }
        >
          {(current) => (
            <>
              Option {current().option_id} is {current().status}
              {current().status === "staged"
                ? " — confirm or reject it in the change review; the repertoire is unchanged until you do."
                : "."}
            </>
          )}
        </Show>
      </div>
    </section>
  );
}

function StagedEditResult(props: { data: Data }) {
  const id = () => props.data.action_id as string;
  const edit = () => stagedEdit(id());
  const stale = () => edit()?.status === "stale";
  return (
    <div class="result-card staged-card">
      <div class="result-title">Proposed {String(props.data.action)} edit</div>
      <div class="result-line">
        {(props.data.path as string[] | undefined)?.join(" ") || "Start position"}
      </div>
      <Show when={Array.isArray(props.data.line)}>
        <div class="result-line">{(props.data.line as string[]).join(" ")}</div>
      </Show>
      <div class="result-summary">
        nodes {String((props.data.before as Data)?.nodes)} →{" "}
        {String((props.data.after as Data)?.nodes)} · leaves{" "}
        {String((props.data.before as Data)?.leaves)} → {String((props.data.after as Data)?.leaves)}
      </div>
      <Show
        when={edit()?.status === "pending"}
        fallback={
          <span class={`result-status ${edit()?.status}`}>
            {stale() ? "Tree changed — preview is stale" : edit()?.status}
          </span>
        }
      >
        <Show when={edit()?.action === "add"}>
          <button
            onClick={() => {
              stagePreview(id());
            }}
          >
            Preview on board
          </button>
        </Show>
        <button class="result-accept" onClick={() => acceptStagedEdit(id())}>
          Accept
        </button>
        <button
          onClick={() => {
            rejectStagedEdit(id());
          }}
        >
          Reject
        </button>
      </Show>
    </div>
  );
}

function ArtifactResult(props: { data: Data }) {
  const id = () => props.data.artifact_id as string;
  const artifact = () => artifactById(id());
  return (
    <div class="result-card artifact-card">
      <div class="result-title">{String(props.data.name ?? "Generated artifact")}</div>
      <div class="result-summary">
        {String(props.data.format).toUpperCase()} · {String(props.data.bytes)} bytes
      </div>
      <button class="result-accept" disabled={!artifact()} onClick={() => saveArtifact(id())}>
        Save
      </button>
    </div>
  );
}

export function findArtifactMetadata(value: unknown): Data[] {
  const found: Data[] = [];
  const visit = (candidate: unknown) => {
    if (!candidate || typeof candidate !== "object") return;
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    const item = candidate as Data;
    if (item.kind === "artifact" && typeof item.artifact_id === "string") found.push(item);
    Object.values(item).forEach(visit);
  };
  visit(value);
  return found;
}

function ArtifactRows(props: { data: Data }) {
  const artifacts = createMemo(() => findArtifactMetadata(props.data));
  return <For each={artifacts()}>{(artifact) => <ArtifactResult data={artifact} />}</For>;
}

const ERROR_LABELS: Record<string, string> = {
  invalid_arguments: "Invalid command arguments",
  engine_unavailable: "Local engine unavailable",
  cancelled: "Cancelled",
  explorer_auth_required: "Lichess token required",
  fetch_failed: "Network request failed",
  missing_criteria: "Search criteria required",
  path_not_found: "Repertoire path not found",
  strategic_fit_finding_not_found: "Strategic Fit finding is unavailable",
  strategic_fit_report_unavailable: "Strategic Fit report is no longer cached",
  strategic_fit_missing_report_identity: "Strategic Fit report identity required",
  strategic_fit_missing_finding_identity: "Strategic Fit finding identity required",
  strategic_fit_stale_page_cursor: "Strategic Fit page cursor is stale",
  strategic_fit_intent_empty_proposal: "Profile proposal was empty",
  strategic_fit_intent_invalid_mode: "Unknown profile mode",
  strategic_fit_intent_unknown_field: "Unknown profile preference",
  strategic_fit_intent_invalid_value: "Profile value is out of range",
  strategic_fit_intent_invalid_concept_id: "Unknown Strategic Fit concept",
  strategic_fit_intent_conflicting_concepts: "Concept is both preferred and avoided",
  strategic_fit_intent_no_change: "Profile already matches the proposal",
  strategic_fit_intent_proposal_stale: "Profile proposal is stale",
  strategic_fit_intent_proposal_not_pending: "Profile proposal is no longer pending",
  strategic_fit_plan_empty: "Plan card was empty",
  strategic_fit_plan_invalid_section: "Plan section is not valid",
  strategic_fit_plan_invalid_value: "Plan value is out of bounds",
  strategic_fit_plan_missing_support: "Plan section cites no evidence",
  strategic_fit_plan_unsupported_concept: "Concept is not part of this finding",
  strategic_fit_plan_unsupported_checkpoint: "Checkpoint is not part of this finding",
  strategic_fit_plan_unsupported_drill: "Drill is not part of this finding",
  strategic_fit_plan_unsupported_move: "Move is not on a validated path",
  strategic_fit_plan_unsupported_model_game: "Model game or position is unsupported",
  strategic_fit_plan_evidence_unavailable: "Plan evidence is unavailable",
  strategic_fit_plan_stale: "Plan card is stale",
  strategic_fit_plan_not_pending: "Plan card is no longer pending",
  strategic_fit_portfolio_empty_constraints: "Redesign bounds were empty",
  strategic_fit_portfolio_unknown_constraint: "Unknown redesign bound",
  strategic_fit_portfolio_invalid_value: "Redesign bound is out of range",
  strategic_fit_portfolio_unconfirmed_constraints: "Redesign bounds are not confirmed",
  strategic_fit_portfolio_evidence_unavailable: "No candidates to build a portfolio from",
  strategic_fit_portfolio_unknown_option: "Portfolio option does not exist",
  strategic_fit_portfolio_stale: "Redesign bounds are stale",
  strategic_fit_portfolio_not_pending: "Redesign bounds are no longer pending",
  strategic_fit_stale_report: "Strategic Fit report is stale",
  strategic_fit_stale_revision: "Strategic Fit report is stale",
  variation_not_found: "Repertoire path not found",
  stale_revision: "Document changed",
};

function ErrorResult(props: { data: Data }) {
  const code = () => String(props.data.error ?? "command_failed");
  return (
    <div class={`result-card result-error-card error-${code()}`} role="alert">
      <div class="result-title">{ERROR_LABELS[code()] ?? code().replace(/_/g, " ")}</div>
      <Show when={props.data.reason}>
        <div class="result-summary">{String(props.data.reason)}</div>
      </Show>
      <div class="result-code">{code()}</div>
    </div>
  );
}

function PositionResult(props: { data: Data }) {
  return (
    <div class="result-card">
      <div class="result-title">Board position</div>
      <div class="result-line">{String(props.data.fen ?? "")}</div>
      <button
        onClick={() => {
          navigateFen(String(props.data.fen ?? ""));
        }}
      >
        Go to position
      </button>
    </div>
  );
}

function ReviewSummary(props: { data: Data }) {
  const side = (name: "white" | "black") => props.data[name] as Data | undefined;
  return (
    <div class="result-card">
      <div class="result-title">Game review · {String(props.data.total_moves)} moves</div>
      <div class="result-summary">
        White {String(side("white")?.accuracy_pct ?? "—")}% · {String(side("white")?.blunders ?? 0)}{" "}
        blunders
      </div>
      <div class="result-summary">
        Black {String(side("black")?.accuracy_pct ?? "—")}% · {String(side("black")?.blunders ?? 0)}{" "}
        blunders
      </div>
      <NavigationRows data={props.data} />
    </div>
  );
}

function ReportResult(props: { title: string; summary: string; data: Data }) {
  return (
    <div class="result-card report-card">
      <div class="result-title">{props.title}</div>
      <div class="result-summary">{props.summary}</div>
      <NavigationRows data={props.data} />
    </div>
  );
}

const byOperation: Record<string, (data: Data) => unknown> = {
  get_position: (data) => <PositionResult data={data} />,
  get_game_summary: (data) => <ReviewSummary data={data} />,
  analyze_game: (data) => (
    <div class="result-card">
      <div class="result-title">Move findings · {String(data.total_moves ?? 0)} analysed</div>
      <NavigationRows data={data} />
    </div>
  ),
  find_repertoire_gaps: (data) => (
    <div class="result-card">
      <div class="result-title">Repertoire findings</div>
      <NavigationRows data={data} />
    </div>
  ),
  suggest_gap_fills: (data) => (
    <div class="result-card">
      <div class="result-title">Gap-fill choices</div>
      <NavigationRows data={data} />
    </div>
  ),
  audit_repertoire_moves: (data) => (
    <ReportResult
      title="Prescribed-move audit"
      summary={`${String(data.findings && Array.isArray(data.findings) ? data.findings.length : 0)} ranked findings · ${String(data.moves_audited ?? 0)} moves audited across ${String(data.positions_scanned ?? 0)} positions`}
      data={data}
    />
  ),
  find_only_moves: (data) => (
    <ReportResult
      title="Only-move training positions"
      summary={`${String(data.only_moves_found ?? 0)} critical positions · ${String(data.positions_scanned ?? 0)} scanned · ${String(Array.isArray(data.lines) ? data.lines.length : 0)} ranked lines`}
      data={data}
    />
  ),
  find_structures: (data) => (
    <ReportResult
      title="Structure search"
      summary={`${String(data.total_matches ?? 0)} matches across ${String(data.leaves_total ?? 0)} repertoire leaves`}
      data={data}
    />
  ),
  prep_vs_opponent: (data) => (
    <ReportResult
      title={`Opponent preparation · ${String(data.username ?? "unknown")}`}
      summary={`${String(data.games_matched_color ?? 0)} relevant games · ${String(data.coverage_pct ?? "—")}% reached prep · ${String(Array.isArray(data.uncovered_opponent_moves) ? data.uncovered_opponent_moves.length : 0)} targets`}
      data={data}
    />
  ),
  analyze_repertoire_congruence: (data) => (
    <StrategicFitResult report={asStrategicFitReport(data)!} />
  ),
  get_strategic_fit_report: (data) => {
    const projection = asStrategicFitRetrieval(data);
    return (
      <>
        {projection ? (
          <StrategicFitRetrievalResult projection={projection} />
        ) : (
          <div class="result-card">
            <NavigationRows data={data} />
          </div>
        )}
      </>
    );
  },
  export_annotated_repertoire: (data) => (
    <ReportResult
      title="Annotated repertoire"
      summary={`Audit ${String((data.annotated as Data | undefined)?.audit ?? 0)} · only moves ${String((data.annotated as Data | undefined)?.only_moves ?? 0)} · gaps ${String((data.annotated as Data | undefined)?.gaps ?? 0)} · congruence ${String((data.annotated as Data | undefined)?.congruence ?? 0)}`}
      data={data}
    />
  ),
};
const byKind: Record<string, (data: Data) => unknown> = {
  staged_edit: (data) => <StagedEditResult data={data} />,
  strategic_fit_profile_proposal: (data) => <StrategicFitProposalResult data={data} />,
  strategic_fit_plan_basis: (data) => <StrategicFitPlanBasisResult data={data} />,
  strategic_fit_plan_card: (data) => <StrategicFitPlanCardResult data={data} />,
  strategic_fit_portfolio_constraints: (data) => (
    <StrategicFitPortfolioConstraintsResult data={data} />
  ),
  strategic_fit_portfolio: (data) => <StrategicFitPortfolioResultCard data={data} />,
};

/** Typed renderer registry: operation overrides result kind, then navigation is the data fallback. */
export default function ToolResult(props: Props) {
  const data = createMemo(() => parse(props.content));
  const renderer = () => data() && (byOperation[props.operation] ?? byKind[String(data()!.kind)]);
  const hasArtifacts = () => (data() ? findArtifactMetadata(data()).length > 0 : false);
  return (
    <>
      <Show
        when={data() && typeof data()!.error === "string"}
        fallback={
          <>
            <Show when={data() && renderer()}>{(render) => render()(data()!) as never}</Show>
            <Show when={data() && !renderer() && !hasArtifacts()}>
              <div class="result-card">
                <NavigationRows data={data()!} />
              </div>
            </Show>
            <Show when={data()}>{(value) => <ArtifactRows data={value()} />}</Show>
          </>
        }
      >
        <ErrorResult data={data()!} />
      </Show>
      <details class="tool-result-raw">
        <summary>Raw JSON</summary>
        <pre>{props.content}</pre>
      </details>
    </>
  );
}
