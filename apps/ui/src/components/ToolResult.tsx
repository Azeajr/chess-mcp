import { For, Show, createMemo } from "solid-js";
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
