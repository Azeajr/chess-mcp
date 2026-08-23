/**
 * RepertoirePanel (Feature 6): the no-API repertoire backbone. Collapsible sections —
 * Tier A scans (Gaps, Congruence) whose rows navigate to the flagged line, and Tier B actions
 * (Extend, Fix) whose rows stage a preview line (gold arrow + Accept, reusing Feature 1).
 * Everything runs on the local engine / pure tree math; chat is the interpretive layer on top.
 */
import { For, Show, createSignal, createEffect, onCleanup } from "solid-js";
import {
  gaps,
  covered,
  scanning,
  progress,
  scanError,
  scanGaps,
  cancelScan,
  fills,
  fillGap,
  gapKey,
  type Gap,
  type CoveredGap,
  type FillOption,
  type GapFill,
} from "../store/gaps";
import {
  complementary,
  compScanning,
  compError,
  scanComplementary,
  extBridges,
  bridgeScanning,
  bridgeError,
  scanBridges,
  pruneSuggestions,
  pruneScanning,
  pruneError,
  pruneDone,
  pruneTotal,
  scanPrune,
  cancelPrune,
  inspectShortcut,
  inspectKey,
  shortcutKey,
  comparison,
  coverage,
  inspecting,
  inspectError,
} from "../store/repertoire";
import type { ExtendedBridge, PruneSuggestion } from "@chess-mcp/chess-tools";
import { stagePreviewLine, preview, acceptPreview, clearPreview } from "../store/suggestions";
import { actions, currentTree, currentPath, fen, color } from "../store/game";
import {
  commandStates,
  executeCommand,
  cancelCommand,
  type DirectCommand,
} from "../store/commands";
import { saveArtifact } from "../store/artifacts";
import { analysisDepth } from "../store/engine-settings";
import StrategicFitTransfer from "./StrategicFitTransfer";
import { setStrategicFitWorkspaceOpen } from "../store/ui";
import Button from "./primitives/Button";
import ErrorState from "./primitives/ErrorState";
import PanelHeader from "./primitives/PanelHeader";
import Progress from "./primitives/Progress";
import Select from "./primitives/Select";
import Status from "./primitives/Status";
import InteractiveRow from "./primitives/InteractiveRow";
import { centipawnDelta, centipawnText, evaluationText, numbered } from "../content/format";
import { STRATEGIC_FIT_ENTRY } from "../content/strategicFit";

const usersTurn = () => (fen().split(" ")[1] === "w" ? "white" : "black") === color();

export default function RepertoirePanel() {
  const [mode, setMode] = createSignal<"low_memorization" | "sharp">("low_memorization");
  const [structure, setStructure] = createSignal("");
  const [opponent, setOpponent] = createSignal("");
  const state = (command: DirectCommand) => commandStates()[command];
  const rows = (command: DirectCommand, key: string) =>
    (state(command).result?.[key] as Record<string, unknown>[] | undefined) ?? [];

  /**
   * WP-022 AC-4: the one-line summary a collapsed group shows after its tool settles — the result
   * count plus how long ago it finished. Returns null while the tool has not settled, so the
   * summary stays clean before the first run.
   */
  const resultCount = (command: DirectCommand): number | null => {
    const result = state(command).result;
    if (!result) return null;
    for (const key of ["findings", "matches", "lines"]) {
      const list = result[key];
      if (Array.isArray(list)) return list.length;
    }
    // Exports carry an artifact rather than rows; one artifact is the produced result.
    return result.artifact_id ? 1 : null;
  };
  const [nowTick, setNowTick] = createSignal(Date.now());
  // WP-022 AC-4: summaries show "how long ago" — keep the clock moving so a settled timestamp
  // doesn't freeze at "just now". The timer only runs while any command has completedAt.
  createEffect(() => {
    const states = commandStates();
    if (!Object.values(states).some((entry) => entry.completedAt !== undefined)) return;
    const interval = setInterval(() => setNowTick(Date.now()), 30_000);
    onCleanup(() => {
      clearInterval(interval);
    });
  });
  const relativeTime = (at: number): string => {
    const seconds = Math.max(0, Math.round((nowTick() - at) / 1000));
    if (seconds < 5) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ago`;
  };
  const collapsedSummary = (command: DirectCommand): string | null => {
    const entry = state(command);
    if (entry.status === "running" || entry.status === "idle") return null;
    const count = resultCount(command);
    if (count === null) return null;
    const at = entry.completedAt;
    return `${count} ${count === 1 ? "result" : "results"}${at ? ` · ${relativeTime(at)}` : ""}`;
  };
  const commandButton = (
    command: DirectCommand,
    label: string,
    args: () => Record<string, unknown> = () => ({}),
  ) => (
    <Show
      when={state(command).status === "running"}
      fallback={
        <button
          class="scan-btn"
          onClick={(e) => {
            e.preventDefault();
            void executeCommand(command, {
              ...args(),
              ...([
                "audit_repertoire_moves",
                "find_only_moves",
                "export_annotated_repertoire",
              ].includes(command)
                ? { depth: analysisDepth() }
                : {}),
            });
          }}
        >
          {label}
        </button>
      }
    >
      <button
        class="scan-btn"
        onClick={(e) => {
          e.preventDefault();
          cancelCommand(command);
        }}
      >
        Cancel
      </button>
    </Show>
  );
  const commandStatus = (command: DirectCommand) => (
    <>
      <Show when={state(command).progress}>
        {(p) => (
          <div class="scan-progress">
            <Progress
              class="scan-progress-meter"
              label={`${command} progress`}
              max={p().total ?? 1}
              value={p().total ? Math.min(p().done, p().total ?? 0) : undefined}
            />
            <span>
              {p().detail ?? "working"} {p().total ? `${p().done}/${p().total}` : "…"}
            </span>
          </div>
        )}
      </Show>
      <Show when={state(command).error}>{(message) => <ErrorState message={message()} />}</Show>
    </>
  );

  const navSan = (sans: string[]) => {
    const ip = currentTree().indexPathOfSan(sans);
    if (ip) actions.goto(ip);
  };
  const currentAt = (path: readonly number[]) =>
    path.length === currentPath().length &&
    path.every((index, position) => currentPath()[position] === index);
  const currentAtSan = (sans: readonly string[]) => {
    const path = currentTree().indexPathOfSan([...sans]);
    return path ? currentAt(path) : false;
  };

  // Stub connector: stage the whole engine-vetted sequence that rejoins prep.
  const onExtBridge = (b: ExtendedBridge) => {
    const fromIdx = currentTree().indexPathOfSan(b.fromPath);
    if (!fromIdx) return;
    actions.goto(fromIdx);
    stagePreviewLine(fromIdx, b.moves);
  };

  // Prune: jump to the re-route node and stage the transposing move so the merge is visible.
  const onPrune = (p: PruneSuggestion) => {
    const atIdx = currentTree().indexPathOfSan(p.atPath);
    if (!atIdx) return;
    actions.goto(atIdx);
    stagePreviewLine(atIdx, [p.rerouteMove]);
  };
  // Click a fill option → stage [uncoveredMove, reply, …PV] from the gap node. Length tracks the
  // repertoire's typical depth (filtered median), so the new line is as deep as the rest; ≥2 plies so
  // the gap is always actually closed. Accept (gold-arrow UI) grafts in memory; Save persists.
  const onFill = (g: Gap, opt: FillOption) => {
    actions.goto(g.path); // so the gold preview arrow is visible immediately
    stagePreviewLine(g.path, opt.line); // the staged length is decided in the store (median-deep)
  };
  const gapLine = (g: Gap) => {
    try {
      return numbered(currentTree().sanPathAt(g.path));
    } catch {
      return "";
    }
  };
  // The whole prospective line is shown inline (numbered, continuing from the gap depth) — no hover.
  const FillRow = (props: { g: Gap; opt: FillOption; label: string }) => (
    <InteractiveRow
      class="indent fill-row"
      current={currentAt(props.g.path)}
      onClick={() => {
        onFill(props.g, props.opt);
      }}
    >
      <span class="san">{numbered(props.opt.line, props.g.path.length)}</span>
      <span class="ev">{props.opt.evalCp == null ? "—" : centipawnText(props.opt.evalCp)}</span>
      <span class="fit">
        {props.label} · fit {props.opt.fit.toFixed(2)}
      </span>
    </InteractiveRow>
  );

  return (
    <div class="rep-panel">
      <PanelHeader title="Repertoire" />
      <div class="scope-note">Engine-backed operations use depth {analysisDepth()}.</div>
      <section class="strategic-fit-entry" aria-labelledby="strategic-fit-entry-title">
        <div>
          <div id="strategic-fit-entry-title" class="strategic-fit-entry-title">
            {STRATEGIC_FIT_ENTRY.question}
          </div>
          <div class="strategic-fit-entry-copy">
            {STRATEGIC_FIT_ENTRY.summary} {STRATEGIC_FIT_ENTRY.reassurance}
          </div>
        </div>
        <Button
          variant="primary"
          type="button"
          class="strategic-fit-open-button"
          onClick={(event) => {
            // macOS browsers do not give a <button> DOM focus when it is clicked — a platform
            // convention WebKit and Chrome both follow, and one Linux CI never exercises. Without
            // this the workspace captured document.body as its return target, so closing the
            // dialog restored focus to nothing: reproduced on every real macOS run (32225391111,
            // 32226854386, 32228019888), never once on Linux. Focusing here makes the opener a
            // real return target on every platform.
            event.currentTarget.focus();
            setStrategicFitWorkspaceOpen(true);
          }}
        >
          {STRATEGIC_FIT_ENTRY.action}
        </Button>
      </section>
      <Show when={preview()}>
        {(active) => (
          <div class="rep-preview" role="status" aria-label="Staged repertoire line">
            <div class="rep-preview-label">Staged line</div>
            <div class="rep-preview-line">{numbered(active().sans, active().fromPath.length)}</div>
            <div class="rep-preview-actions">
              <button class="accept" onClick={acceptPreview}>
                Accept line
              </button>
              <button class="reject" onClick={clearPreview}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </Show>
      {/* WP-022 group 1: Analyze */}
      <section class="rep-group" aria-label="Analyze">
        <PanelHeader title="Analyze" />
        <details class="rep-section">
          <summary>
            <span>Prescribed-move audit</span>
            {/* WP-022 AC-4: one-line result count + relative time, visible while collapsed. */}
            <Show when={collapsedSummary("audit_repertoire_moves")}>
              {(text) => <span class="rep-summary-note">{text()}</span>}
            </Show>
            {commandButton("audit_repertoire_moves", "Audit")}
          </summary>
          <div class="scope-note">Up to 20 positions · local engine</div>
          {commandStatus("audit_repertoire_moves")}
          <For each={rows("audit_repertoire_moves", "findings")}>
            {(finding) => (
              <InteractiveRow
                current={currentAtSan(finding.path as string[])}
                onClick={() => {
                  navSan(finding.path as string[]);
                }}
              >
                <Status class={`sev sev-${String(finding.classification)}`}>
                  {String(finding.classification)}
                </Status>
                <span class="san">
                  {(finding.path as string[]).join(" ")} · {String(finding.prescribed)} →{" "}
                  {String(finding.best_move)}
                </span>
                <span class="ev">−{(Number(finding.cp_loss) / 100).toFixed(2)}</span>
              </InteractiveRow>
            )}
          </For>
        </details>

        <details class="rep-section">
          <summary>
            <span>Only moves & drills</span>
            {/* WP-022 AC-4: one-line result count + relative time, visible while collapsed. */}
            <Show when={collapsedSummary("find_only_moves")}>
              {(text) => <span class="rep-summary-note">{text()}</span>}
            </Show>
            {commandButton("find_only_moves", "Find", () => ({
              max_positions: 60,
            }))}
          </summary>
          <div class="scope-note">Up to 60 positions · cancellable</div>
          {commandStatus("find_only_moves")}
          <For each={rows("find_only_moves", "findings")}>
            {(finding) => (
              <InteractiveRow
                current={currentAtSan(finding.path as string[])}
                onClick={() => {
                  navSan(finding.path as string[]);
                }}
              >
                <span class="bridge-icon">!</span>
                <span class="san">
                  {(finding.path as string[]).join(" ") || "Start"} · {String(finding.best_move)}
                </span>
                <span class="fit">margin {Number(finding.margin)}cp</span>
              </InteractiveRow>
            )}
          </For>
          <Show when={state("find_only_moves").status === "completed"}>
            <button
              class="fix-btn"
              onClick={() =>
                void executeCommand("find_only_moves", {
                  max_positions: 60,
                  export_deck: true,
                  depth: analysisDepth(),
                })
              }
            >
              Generate CSV deck
            </button>
          </Show>
          <Show
            when={
              (state("find_only_moves").result?.deck as Record<string, unknown> | undefined)
                ?.artifact_id
            }
          >
            {(id) => (
              <button
                class="fix-btn"
                onClick={() => {
                  const artifactId = id();
                  if (typeof artifactId === "string") saveArtifact(artifactId);
                }}
              >
                Save CSV deck
              </button>
            )}
          </Show>
        </details>

        <details class="rep-section">
          <summary>
            <span>Structure search</span>
            {/* WP-022 AC-4: one-line result count + relative time, visible while collapsed. */}
            <Show when={collapsedSummary("find_structures")}>
              {(text) => <span class="rep-summary-note">{text()}</span>}
            </Show>
            {commandButton("find_structures", "Search", () => ({
              structure: structure(),
            }))}
          </summary>
          <div class="command-input">
            <input
              aria-label="Structure name"
              value={structure()}
              placeholder="e.g. Carlsbad"
              onInput={(e) => setStructure(e.currentTarget.value)}
            />
          </div>
          {commandStatus("find_structures")}
          <For each={rows("find_structures", "matches")}>
            {(match) => (
              <InteractiveRow
                current={currentAtSan(match.path as string[])}
                onClick={() => {
                  navSan(match.path as string[]);
                }}
              >
                <span class="san">{(match.path as string[]).join(" ")}</span>
                <span class="fit">{String(match.structure)}</span>
              </InteractiveRow>
            )}
          </For>
        </details>
      </section>
      {/* WP-022 group 2: Prepare */}
      <section class="rep-group" aria-label="Prepare">
        <PanelHeader title="Prepare" />
        <details class="rep-section">
          <summary>
            <span>Opponent preparation</span>
            {/* WP-022 AC-4: one-line result count + relative time, visible while collapsed. */}
            <Show when={collapsedSummary("prep_vs_opponent")}>
              {(text) => <span class="rep-summary-note">{text()}</span>}
            </Show>
            {commandButton("prep_vs_opponent", "Prepare", () => ({
              username: opponent(),
            }))}
          </summary>
          <div class="command-input">
            <input
              aria-label="Opponent username"
              value={opponent()}
              placeholder="Lichess username"
              onInput={(e) => setOpponent(e.currentTarget.value)}
            />
          </div>
          {commandStatus("prep_vs_opponent")}
          <For each={rows("prep_vs_opponent", "lines")}>
            {(line) => (
              // A summary line, not an action. Rendering it as a button to satisfy the row-reachability
              // check would put a focus stop in the Tab order that announces "button" and does nothing.
              <div class="rep-row-static">
                <span class="san">{String(line.name)}</span>
                <span class="fit">
                  {String(line.games)} games · {String(line.hit_rate)}% in prep
                </span>
              </div>
            )}
          </For>
        </details>
      </section>
      {/* WP-022 group 3: Generate */}
      <section class="rep-group" aria-label="Generate">
        <PanelHeader title="Generate" />
        <details class="rep-section">
          <summary>
            <span>Annotated repertoire</span>
            {/* WP-022 AC-4: one-line result count + relative time, visible while collapsed. */}
            <Show when={collapsedSummary("export_annotated_repertoire")}>
              {(text) => <span class="rep-summary-note">{text()}</span>}
            </Show>
            {commandButton("export_annotated_repertoire", "Generate", () => ({
              max_positions: 60,
            }))}
          </summary>
          <div class="scope-note">Audit, only moves, gaps, and congruence · up to 60 positions</div>
          {commandStatus("export_annotated_repertoire")}
          <Show when={state("export_annotated_repertoire").result?.artifact_id}>
            {(id) => (
              <button
                class="fix-btn"
                onClick={() => {
                  const artifactId = id();
                  if (typeof artifactId === "string") saveArtifact(artifactId);
                }}
              >
                Save annotated PGN
              </button>
            )}
          </Show>
        </details>

        <StrategicFitTransfer />
      </section>
      {/* WP-022 group 4: Prepare and export — replaces the old "Advanced" heading */}
      <section class="rep-group" aria-label="Prepare and export">
        <PanelHeader title="Prepare and export" />
        {/* Tier A: gaps */}
        <details class="rep-section" open>
          <summary>
            <span>Gaps</span>
            <Show
              when={scanning()}
              fallback={
                <button
                  class="scan-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    void scanGaps();
                  }}
                >
                  Scan
                </button>
              }
            >
              <button
                class="scan-btn"
                onClick={(e) => {
                  e.preventDefault();
                  cancelScan();
                }}
              >
                Cancel
              </button>
            </Show>
          </summary>
          <Show when={progress()}>
            {(p) => (
              <div class="scan-progress">
                <Progress
                  label="Scanning repertoire positions"
                  max={p().total || undefined}
                  value={p().total ? Math.min(p().done, p().total) : undefined}
                />
                <span>{p().total ? `scanning ${p().done}/${p().total}…` : "preparing scan…"}</span>
              </div>
            )}
          </Show>
          <Show when={scanError()}>
            <div class="empty">{scanError()}</div>
          </Show>
          <Show when={!scanning() && gaps().length === 0 && !scanError()}>
            <div class="empty">No scan yet — or no gaps.</div>
          </Show>
          <For each={gaps()}>
            {(g) => {
              const gapState = () => fills()[gapKey(g)];
              const gapFill = (): GapFill | null => {
                const value = gapState();
                return typeof value === "object" && "bestEval" in value ? value : null;
              };
              const gapError = (): string | null => {
                const value = gapState();
                return typeof value === "object" && "error" in value ? value.error : null;
              };
              return (
                <div class="rep-flag">
                  <InteractiveRow
                    current={currentAt(g.path)}
                    onClick={() => {
                      actions.goto(g.path);
                    }}
                    title={`${gapLine(g)} — uncovered: ${g.uncoveredMove}`}
                  >
                    <Status class={`sev sev-${g.severity}`}>{g.severity}</Status>
                    <span class="san">
                      <span class="muted">{gapLine(g)}</span> · {g.uncoveredMove}
                    </span>
                    <span class="ev">{evaluationText({ cp: g.evalCp, mate: g.mate })}</span>
                  </InteractiveRow>
                  <button
                    class="fix-btn fill-btn"
                    onClick={() => {
                      void fillGap(g);
                    }}
                  >
                    Fill this
                  </button>
                  <Show when={gapState() === "loading"}>
                    <div class="scan-progress fill-progress">finding fills…</div>
                  </Show>
                  <Show when={gapError()}>{(error) => <div class="empty">{error()}</div>}</Show>
                  <Show when={gapFill()}>
                    {(fill) => (
                      <>
                        <FillRow g={g} opt={fill().bestEval} label="best eval" />
                        <Show when={fill().bestFit}>
                          {(bf) => (
                            <FillRow
                              g={g}
                              opt={bf()}
                              label={bf().fit > fill().bestEval.fit ? "best fit" : "alt"}
                            />
                          )}
                        </Show>
                      </>
                    )}
                  </Show>
                </div>
              );
            }}
          </For>
          {/* Replies that look uncovered but transpose into prep — false gaps, shown muted. */}
          <For each={covered()}>
            {(c: CoveredGap) => (
              <InteractiveRow
                class="covered"
                current={currentAt(c.path)}
                onClick={() => {
                  actions.goto(c.path);
                }}
                title={`${c.uncoveredMove} transposes into ${c.joinsPath.join(" ")}`}
              >
                <span class="sev">✓</span>
                <span class="san">{c.uncoveredMove}</span>
                <span class="fit">covered → {c.joinsPath.at(-1)}</span>
              </InteractiveRow>
            )}
          </For>
        </details>

        {/* Tier A: connect dangling stubs into prep (engine-vetted) */}
        <details class="rep-section">
          <summary>
            <span>Connect</span>
            <Show
              when={bridgeScanning()}
              fallback={
                <button class="scan-btn" onClick={(e) => (e.preventDefault(), void scanBridges())}>
                  Scan
                </button>
              }
            >
              <span class="scan-progress">…</span>
            </Show>
          </summary>
          <Show when={bridgeError()}>
            <div class="empty">{bridgeError()}</div>
          </Show>
          <Show when={extBridges()?.length === 0}>
            <div class="empty">No stubs that rejoin prep.</div>
          </Show>
          {/* A stopped line continued by the color's engine-best moves until it rejoins existing prep. */}
          <For each={extBridges() ?? []}>
            {(b: ExtendedBridge) => (
              <InteractiveRow
                current={currentAtSan(b.fromPath)}
                onClick={() => {
                  onExtBridge(b);
                }}
                title={`${b.fromPath.join(" ")} → ${b.moves.join(" ")}  joins  ${b.joinsPath.join(" ")}`}
              >
                <span class="bridge-icon">🔗</span>
                <span class="san">
                  {b.fromPath.join(" ")} → {b.moves.join(" ")}
                </span>
                <span class="fit">joins {b.joinsPath.at(-1)}</span>
              </InteractiveRow>
            )}
          </For>
        </details>

        {/* Tier A: shorten a line via an engine-vetted transposition (find_pruning_transpositions) */}
        <details class="rep-section">
          <summary>
            <span>Shorten</span>
            <Show
              when={pruneScanning()}
              fallback={
                <button
                  class="scan-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    void scanPrune();
                  }}
                >
                  Scan
                </button>
              }
            >
              <span class="scan-progress" title="positions analysed / estimated total">
                <Progress
                  label="Shortening repertoire lines"
                  max={pruneTotal() || undefined}
                  value={pruneTotal() ? Math.min(pruneDone(), pruneTotal()) : undefined}
                />
                {pruneTotal() ? `${Math.min(pruneDone(), pruneTotal())}/${pruneTotal()}` : "…"}
                <button
                  class="scan-btn scan-cancel"
                  title="Cancel scan"
                  onClick={(e) => {
                    e.preventDefault();
                    cancelPrune();
                  }}
                >
                  ✕
                </button>
              </span>
            </Show>
          </summary>
          <Show when={pruneError()}>
            <div class="empty">{pruneError()}</div>
          </Show>
          <Show when={pruneSuggestions()?.length === 0}>
            <div class="empty">No shortenable lines.</div>
          </Show>
          <For each={pruneSuggestions() ?? []}>
            {(p: PruneSuggestion) => (
              <>
                <div class="rep-row-action">
                  <InteractiveRow
                    current={currentAtSan(p.atPath)}
                    onClick={() => {
                      onPrune(p);
                    }}
                    title={`${p.linePath.join(" ")}\n@ ${p.atPath.join(" ") || "start"} play ${p.rerouteMove} → joins ${p.joinsPath.join(" ")} (save ${p.savedPlies} ply${centipawnDelta(p.evalDelta)})${p.bestSavings ? "\n★ most moves saved on this line" : ""}${p.bestEval ? `\n★ best eval on this line${p.evalConfirmed ? " (deep-confirmed)" : ""}` : ""}`}
                  >
                    <span class="bridge-icon">✂</span>
                    <span class="san">
                      {p.atPath.join(" ")} → {p.rerouteMove}
                    </span>
                    <Show when={p.bestSavings}>
                      <span class="pick-badge sav" title="most moves saved on this line">
                        ↓
                      </span>
                    </Show>
                    <Show when={p.bestEval}>
                      <span
                        class="pick-badge eval"
                        title={`best eval on this line${p.evalConfirmed ? " (deep-confirmed)" : ""}`}
                      >
                        ★
                      </span>
                    </Show>
                    <span class="fit">
                      −{p.savedPlies}ply{centipawnDelta(p.evalDelta)}
                    </span>
                  </InteractiveRow>
                  <button
                    class={`inspect-btn${inspectKey() === shortcutKey(p) ? " on" : ""}`}
                    aria-label="Inspect quality and coverage safety"
                    title="Inspect: quality (eval + fit) and coverage safety"
                    onClick={() => void inspectShortcut(p)}
                  >
                    ?
                  </button>
                </div>
                <Show when={inspectKey() === shortcutKey(p)}>
                  <div class="shortcut-detail">
                    <Show when={inspecting()}>
                      <span class="empty">checking…</span>
                    </Show>
                    <Show when={inspectError()}>
                      <span class="empty">{inspectError()}</span>
                    </Show>
                    <Show when={comparison()}>
                      {(c) => (
                        <div>
                          <div>
                            quality:{" "}
                            <b>{c().recommend === "transpose" ? "take shortcut" : "keep line"}</b>{" "}
                            <span class="muted">
                              ({c().basis}
                              {c().eval_disagrees_with_fit ? ", eval/fit disagree" : ""})
                            </span>
                          </div>
                          <div class="muted">
                            evalΔ{" "}
                            {c().evalDelta == null ? "?" : ((c().evalDelta ?? 0) / 100).toFixed(2)}{" "}
                            · fit {c().fitStay}→{c().fitTranspose} · {c().structureStay}→
                            {c().structureTranspose}
                          </div>
                          {/* fit weak: the two branches' blended fit is within a rounding-width, so it
                            can't separate them — size-robust, unlike an absolute low-fit cutoff (a
                            large repertoire's on-theme leaves score lower than a small one's). */}
                          <Show when={Math.abs(c().fitStay - c().fitTranspose) < 0.05}>
                            <div class="warn">
                              fit weak — branches resemble the repertoire about equally
                            </div>
                          </Show>
                        </div>
                      )}
                    </Show>
                    <Show when={coverage()}>
                      {(cov) => (
                        <div class={cov().introduces_gap ? "warn" : "safe"}>
                          {cov().introduces_gap
                            ? `⚠ opens ${cov().new_gaps.length} new gap${cov().new_gaps.length === 1 ? "" : "s"}`
                            : "✓ coverage-safe"}
                        </div>
                      )}
                    </Show>
                  </div>
                </Show>
              </>
            )}
          </For>
        </details>

        {/* Tier B: extend from the current position */}
        <details class="rep-section">
          <summary>
            <span>Extend here</span>
            <Select
              class="rep-mode"
              value={mode()}
              onClick={(e) => {
                e.stopPropagation();
              }}
              onChange={(e) => setMode(e.currentTarget.value as "low_memorization" | "sharp")}
            >
              <option value="low_memorization">low-mem</option>
              <option value="sharp">sharp</option>
            </Select>
            <button
              class="scan-btn"
              aria-label="Suggest an extension"
              disabled={!usersTurn()}
              onClick={(e) => (e.preventDefault(), void scanComplementary(mode()))}
            >
              Suggest
            </button>
          </summary>
          <Show when={!usersTurn()}>
            <div class="empty">Navigate to your move to extend from here.</div>
          </Show>
          <Show when={compScanning()}>
            <div class="scan-progress">searching…</div>
          </Show>
          <Show when={compError()}>
            <div class="empty">{compError()}</div>
          </Show>
          <For each={complementary() ?? []}>
            {(m) => (
              <InteractiveRow
                onClick={() => stagePreviewLine(currentPath(), [m.move])}
                title={m.pv}
              >
                <span class="san">{m.move}</span>
                <span class="ev">{centipawnText(m.eval)}</span>
                <span class="fit">
                  {m.profile_match != null
                    ? `fit ${m.profile_match}`
                    : m.sharpness != null
                      ? `sharp ${m.sharpness}`
                      : ""}
                </span>
              </InteractiveRow>
            )}
          </For>
        </details>
      </section>
    </div>
  );
}
