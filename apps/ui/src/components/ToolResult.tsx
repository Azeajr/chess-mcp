import { For, Show, createMemo } from "solid-js";
import type {
  StrategicFinding,
  StrategicFitAnalysisResult,
  StrategicFitPreflight,
  StrategicFitReport,
} from "@chess-mcp/chess-tools";
import { actions, currentTree } from "../store/game";
import { acceptStagedEdit, rejectStagedEdit, stagedEdit, stagePreview } from "../store/suggestions";
import { artifactById, saveArtifact } from "../store/artifacts";

type Data = Record<string, unknown>;
type Props = { operation: string; content: string | null };

const parse = (content: string | null): Data | null => {
  try {
    const value = JSON.parse(content || "null") as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Data : null;
  } catch { return null; }
};

function navigateFen(target: string) {
  const tree = currentTree();
  let found: number[] | null = null;
  const walk = (path: number[]) => {
    if (found) return;
    if (tree.fenAt(path) === target) { found = path; return; }
    tree.nodeAt(path).children.forEach((_child, index) => walk([...path, index]));
  };
  walk([]);
  if (found) actions.goto(found);
}

function NavigationRows(props: { data: Data }) {
  const rows = createMemo(() => {
    const out: { label: string; value: string; go: () => void }[] = [];
    const visit = (value: unknown, key = "result") => {
      if (out.length >= 8 || !value || typeof value !== "object") return;
      if (Array.isArray(value)) { value.slice(0, 12).forEach((item, index) => visit(item, `${key} ${index + 1}`)); return; }
      const item = value as Data;
      const path = [item.path, item.san_path, item.variation_path, item.pivot_path].find((candidate) => Array.isArray(candidate) && candidate.every((move) => typeof move === "string")) as string[] | undefined;
      if (path?.length) {
        const indexPath = currentTree().indexPathOfSan(path);
        if (indexPath) out.push({ label: key, value: path.join(" "), go: () => actions.goto(indexPath) });
      } else if (typeof item.fen === "string") out.push({ label: `${key} position`, value: item.fen, go: () => navigateFen(item.fen as string) });
      else if (typeof item.ply === "number") {
        const mainline = Array.from({ length: item.ply }, () => 0);
        try { currentTree().nodeAt(mainline); out.push({ label: key, value: `Ply ${item.ply}`, go: () => actions.goto(mainline) }); } catch { /* external game */ }
      }
      Object.entries(item).forEach(([childKey, child]) => visit(child, childKey.replace(/_/g, " ")));
    };
    visit(props.data);
    return out;
  });
  return <For each={rows()}>{(row) => <button class="result-nav" onClick={row.go}><span>{row.label}</span><b>{row.value}</b></button>}</For>;
}

const titleCase = (value: string) => value
  .split(/[-_]/)
  .map((part) => part ? `${part[0]!.toUpperCase()}${part.slice(1)}` : part)
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

type StrategicFitChatReport = StrategicFitReport & Partial<Pick<StrategicFitAnalysisResult, "finding_page">>;

function asStrategicFitReport(data: Data): StrategicFitChatReport | null {
  const nested = data.report;
  const candidate = nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as Data
    : data;
  return typeof candidate.report_id === "string" &&
      candidate.preflight !== null && typeof candidate.preflight === "object" &&
      candidate.summary !== null && typeof candidate.summary === "object" &&
      Array.isArray(candidate.findings)
    ? candidate as unknown as StrategicFitChatReport
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
  return <article class="strategic-fit-finding" data-finding-id={props.finding.finding_id}>
    <div class="strategic-fit-finding-head">
      <span class="strategic-fit-category">{props.finding.plain_language_category}</span>
      <span class="strategic-fit-classification">{titleCase(props.finding.classification)}</span>
    </div>
    <div class="strategic-fit-scope">{props.finding.opening_scope} · {props.finding.affected_line_summary}</div>
    <div class="strategic-fit-explanation">{props.finding.explanation}</div>
    <div class="strategic-fit-signals" aria-label="Finding signals">
      <span>Confidence <b>{titleCase(props.finding.confidence.label)} {Math.round(props.finding.confidence.score)}</b></span>
      <span>Difference <b>{titleCase(props.finding.difference.magnitude)}</b></span>
      <span>Replace <b>{titleCase(props.finding.replacement_priority.label)}</b></span>
      <span>Train <b>{titleCase(props.finding.training_priority.label)}</b></span>
    </div>
    <div class="strategic-fit-reference">
      <code>{props.finding.finding_id}</code>
      <Show when={path()}>{(safePath) =>
        <button
          class="result-nav strategic-fit-nav"
          aria-label={`Go to line for ${props.finding.plain_language_category}`}
          onClick={() => goToSanPath(safePath())}
        ><span>Go to line</span><b>{safePath().join(" ")}</b></button>
      }</Show>
    </div>
  </article>;
}

function StrategicFitResult(props: { report: StrategicFitChatReport }) {
  const state = () => strategicFitChatState(props.report.preflight, props.report.findings);
  const totalFindings = () => props.report.finding_page?.total_count ?? props.report.findings.length;
  const unresolved = () => props.report.summary.unresolved_finding_count;
  const issueCounts = () => props.report.preflight.issues.reduce((counts, issue) => {
    counts[issue.severity]++;
    return counts;
  }, { blocking: 0, degraded: 0, informational: 0 });
  return <section
    class={`result-card report-card strategic-fit-card strategic-fit-${state()}`}
    data-report-id={props.report.report_id}
    aria-label="Strategic Fit report"
  >
    <div class="result-title">Strategic Fit · {STRATEGIC_FIT_STATE_LABELS[state()]}</div>
    <div class="strategic-fit-report-id">Report <code>{props.report.report_id}</code></div>
    <div class="strategic-fit-counts" aria-label="Strategic Fit counts">
      <span>{totalFindings()} finding{totalFindings() === 1 ? "" : "s"}</span>
      <span>{unresolved()} unresolved</span>
      <span>{props.report.preflight.comparable_route_count}/{props.report.preflight.route_count} comparable routes</span>
      <span>{props.report.summary.insufficient_evidence_branch_count} incomplete branches</span>
    </div>
    <div class="result-summary strategic-fit-preflight">
      Preflight {titleCase(props.report.preflight.state)} · {issueCounts().blocking} blocking · {issueCounts().degraded} degraded · {issueCounts().informational} informational
    </div>
    <Show when={props.report.preflight.issues.length > 0}>
      <ul class="strategic-fit-issues">
        <For each={props.report.preflight.issues.slice(0, 3)}>{(issue) =>
          <li><b>{titleCase(issue.severity)}</b>: {issue.message}</li>
        }</For>
      </ul>
    </Show>
    <Show when={props.report.findings.length > 0} fallback={
      <div class="strategic-fit-empty">No findings are available from this report. Review the preflight evidence before drawing a conclusion.</div>
    }>
      <div class="strategic-fit-findings-title">Top findings</div>
      <For each={props.report.findings.slice(0, 3)}>{(finding) => <FindingCard finding={finding} />}</For>
      <Show when={totalFindings() > Math.min(3, props.report.findings.length)}>
        <div class="strategic-fit-more">Showing {Math.min(3, props.report.findings.length)} of {totalFindings()} findings.</div>
      </Show>
    </Show>
  </section>;
}

function LegacyCongruenceResult(props: { data: Data }) {
  const findings = () => Array.isArray(props.data.incongruencies) ? props.data.incongruencies as Data[] : [];
  return <div class="result-card report-card strategic-fit-legacy-card">
    <div class="result-title">Congruence · Legacy projected result</div>
    <div class="result-summary">{findings().length} projected finding{findings().length === 1 ? "" : "s"}; native Strategic Fit evidence is unavailable in this result.</div>
    <For each={findings().slice(0, 3)}>{(finding) => {
      const paths = Array.isArray(finding.paths)
        ? finding.paths.filter((path): path is string[] => Array.isArray(path) && path.every((move) => typeof move === "string"))
        : [];
      const path = () => navigableSanPath(paths);
      return <div class="strategic-fit-finding" data-finding-id={String(finding.source_finding_id ?? "")}>
        <div class="strategic-fit-finding-head"><span class="strategic-fit-category">{titleCase(String(finding.type ?? "finding"))}</span><span>{titleCase(String(finding.severity ?? ""))}</span></div>
        <div class="strategic-fit-explanation">{String(finding.description ?? "")}</div>
        <Show when={path()}>{(safePath) =>
          <button class="result-nav strategic-fit-nav" onClick={() => goToSanPath(safePath())}><span>Go to line</span><b>{safePath().join(" ")}</b></button>
        }</Show>
      </div>;
    }}</For>
  </div>;
}

function StagedEditResult(props: { data: Data }) {
  const id = () => props.data.action_id as string;
  const edit = () => stagedEdit(id());
  const stale = () => edit()?.status === "stale";
  return <div class="result-card staged-card">
    <div class="result-title">Proposed {String(props.data.action)} edit</div>
    <div class="result-line">{(props.data.path as string[] | undefined)?.join(" ") || "Start position"}</div>
    <Show when={Array.isArray(props.data.line)}><div class="result-line">{(props.data.line as string[]).join(" ")}</div></Show>
    <div class="result-summary">
      nodes {String((props.data.before as Data)?.nodes)} → {String((props.data.after as Data)?.nodes)} · leaves {String((props.data.before as Data)?.leaves)} → {String((props.data.after as Data)?.leaves)}
    </div>
    <Show when={edit()?.status === "pending"} fallback={<span class={`result-status ${edit()?.status}`}>{stale() ? "Tree changed — preview is stale" : edit()?.status}</span>}>
      <Show when={edit()?.action === "add"}><button onClick={() => stagePreview(id())}>Preview on board</button></Show>
      <button class="result-accept" onClick={() => acceptStagedEdit(id())}>Accept</button>
      <button onClick={() => rejectStagedEdit(id())}>Reject</button>
    </Show>
  </div>;
}

function ArtifactResult(props: { data: Data }) {
  const id = () => props.data.artifact_id as string;
  const artifact = () => artifactById(id());
  return <div class="result-card artifact-card">
    <div class="result-title">{String(props.data.name ?? "Generated artifact")}</div>
    <div class="result-summary">{String(props.data.format).toUpperCase()} · {String(props.data.bytes)} bytes</div>
    <button class="result-accept" disabled={!artifact()} onClick={() => saveArtifact(id())}>Save</button>
  </div>;
}

export function findArtifactMetadata(value: unknown): Data[] {
  const found: Data[] = [];
  const visit = (candidate: unknown) => {
    if (!candidate || typeof candidate !== "object") return;
    if (Array.isArray(candidate)) { candidate.forEach(visit); return; }
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
  strategic_fit_stale_report: "Strategic Fit report is stale",
  strategic_fit_stale_revision: "Strategic Fit report is stale",
  variation_not_found: "Repertoire path not found",
  stale_revision: "Document changed",
};

function ErrorResult(props: { data: Data }) {
  const code = () => String(props.data.error ?? "command_failed");
  return <div class={`result-card result-error-card error-${code()}`} role="alert">
    <div class="result-title">{ERROR_LABELS[code()] ?? code().replace(/_/g, " ")}</div>
    <Show when={props.data.reason}><div class="result-summary">{String(props.data.reason)}</div></Show>
    <div class="result-code">{code()}</div>
  </div>;
}

function PositionResult(props: { data: Data }) {
  return <div class="result-card">
    <div class="result-title">Board position</div>
    <div class="result-line">{String(props.data.fen ?? "")}</div>
    <button onClick={() => navigateFen(String(props.data.fen ?? ""))}>Go to position</button>
  </div>;
}

function ReviewSummary(props: { data: Data }) {
  const side = (name: "white" | "black") => props.data[name] as Data | undefined;
  return <div class="result-card">
    <div class="result-title">Game review · {String(props.data.total_moves)} moves</div>
    <div class="result-summary">White {String(side("white")?.accuracy_pct ?? "—")}% · {String(side("white")?.blunders ?? 0)} blunders</div>
    <div class="result-summary">Black {String(side("black")?.accuracy_pct ?? "—")}% · {String(side("black")?.blunders ?? 0)} blunders</div>
    <NavigationRows data={props.data} />
  </div>;
}

function ReportResult(props: { title: string; summary: string; data: Data }) {
  return <div class="result-card report-card">
    <div class="result-title">{props.title}</div>
    <div class="result-summary">{props.summary}</div>
    <NavigationRows data={props.data} />
  </div>;
}

const byOperation: Record<string, (data: Data) => unknown> = {
  get_position: (data) => <PositionResult data={data} />,
  get_game_summary: (data) => <ReviewSummary data={data} />,
  analyze_game: (data) => <div class="result-card"><div class="result-title">Move findings · {String(data.total_moves ?? 0)} analysed</div><NavigationRows data={data} /></div>,
  find_repertoire_gaps: (data) => <div class="result-card"><div class="result-title">Repertoire findings</div><NavigationRows data={data} /></div>,
  suggest_gap_fills: (data) => <div class="result-card"><div class="result-title">Gap-fill choices</div><NavigationRows data={data} /></div>,
  audit_repertoire_moves: (data) => <ReportResult
    title="Prescribed-move audit"
    summary={`${String(data.findings && Array.isArray(data.findings) ? data.findings.length : 0)} ranked findings · ${String(data.moves_audited ?? 0)} moves audited across ${String(data.positions_scanned ?? 0)} positions`}
    data={data}
  />,
  find_only_moves: (data) => <ReportResult
    title="Only-move training positions"
    summary={`${String(data.only_moves_found ?? 0)} critical positions · ${String(data.positions_scanned ?? 0)} scanned · ${String(Array.isArray(data.lines) ? data.lines.length : 0)} ranked lines`}
    data={data}
  />,
  find_structures: (data) => <ReportResult
    title="Structure search"
    summary={`${String(data.total_matches ?? 0)} matches across ${String(data.leaves_total ?? 0)} repertoire leaves`}
    data={data}
  />,
  prep_vs_opponent: (data) => <ReportResult
    title={`Opponent preparation · ${String(data.username ?? "unknown")}`}
    summary={`${String(data.games_matched_color ?? 0)} relevant games · ${String(data.coverage_pct ?? "—")}% reached prep · ${String(Array.isArray(data.uncovered_opponent_moves) ? data.uncovered_opponent_moves.length : 0)} targets`}
    data={data}
  />,
  analyze_repertoire_congruence: (data) => {
    const report = asStrategicFitReport(data);
    return report
      ? <StrategicFitResult report={report} />
      : <LegacyCongruenceResult data={data} />;
  },
  export_annotated_repertoire: (data) => <ReportResult
    title="Annotated repertoire"
    summary={`Audit ${String((data.annotated as Data | undefined)?.audit ?? 0)} · only moves ${String((data.annotated as Data | undefined)?.only_moves ?? 0)} · gaps ${String((data.annotated as Data | undefined)?.gaps ?? 0)} · congruence ${String((data.annotated as Data | undefined)?.congruence ?? 0)}`}
    data={data}
  />,
};
const byKind: Record<string, (data: Data) => unknown> = {
  staged_edit: (data) => <StagedEditResult data={data} />,
};

/** Typed renderer registry: operation overrides result kind, then navigation is the data fallback. */
export default function ToolResult(props: Props) {
  const data = createMemo(() => parse(props.content));
  const renderer = () => data() && (byOperation[props.operation] ?? byKind[String(data()!.kind)]);
  const hasArtifacts = () => data() ? findArtifactMetadata(data()).length > 0 : false;
  return <>
    <Show when={data() && typeof data()!.error === "string"} fallback={
      <>
        <Show when={data() && renderer()}>{(render) => render()(data()!) as never}</Show>
        <Show when={data() && !renderer() && !hasArtifacts()}><div class="result-card"><NavigationRows data={data()!} /></div></Show>
        <Show when={data()}>{(value) => <ArtifactRows data={value()} />}</Show>
      </>
    }><ErrorResult data={data()!} /></Show>
    <details class="tool-result-raw"><summary>Raw JSON</summary><pre>{props.content}</pre></details>
  </>;
}
