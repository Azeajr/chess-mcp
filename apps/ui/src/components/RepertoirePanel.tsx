/**
 * RepertoirePanel (Feature 6): the no-API repertoire backbone. Collapsible sections —
 * Tier A scans (Gaps, Congruence) whose rows navigate to the flagged line, and Tier B actions
 * (Extend, Fix) whose rows stage a preview line (gold arrow + Accept, reusing Feature 1).
 * Everything runs on the local engine / pure tree math; chat is the interpretive layer on top.
 */
import { For, Show, createSignal } from "solid-js";
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
  congruence,
  congScanning,
  congError,
  scanCongruence,
  complementary,
  compScanning,
  compError,
  scanComplementary,
  replacements,
  fixFlag,
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
  type CongruenceFlag,
  type ReplacementResult,
} from "../store/repertoire";
import type { ExtendedBridge, PruneSuggestion } from "@chess-mcp/chess-tools";
import { stagePreviewLine, preview, acceptPreview, clearPreview } from "../store/suggestions";
import { actions, currentTree, currentPath, fen, color } from "../store/game";
import { commandStates, executeCommand, cancelCommand, type DirectCommand } from "../store/commands";
import { saveArtifact } from "../store/artifacts";
import { analysisDepth } from "../store/engine-settings";
import StrategicFitTransfer from "./StrategicFitTransfer";
import { setStrategicFitWorkspaceOpen } from "../store/ui";

function gapEval(g: Gap): string {
  if (g.mate !== null) return `M${Math.abs(g.mate)}`;
  const cp = g.evalCp ?? 0;
  return (cp >= 0 ? "+" : "") + (cp / 100).toFixed(2);
}
const cp2 = (cp: number) => (cp >= 0 ? "+" : "") + (cp / 100).toFixed(2);
/** SAN list → numbered notation continuing from `startPly` half-moves: "1. e4 c6 2. Nf3 d5". */
function numbered(sans: string[], startPly = 0): string {
  const out: string[] = [];
  for (let i = 0; i < sans.length; i++) {
    const ply = startPly + i;
    const no = Math.floor(ply / 2) + 1;
    if (ply % 2 === 0) out.push(`${no}. ${sans[i]}`);
    else if (i === 0) out.push(`${no}... ${sans[i]}`);
    else out.push(sans[i]!);
  }
  return out.join(" ");
}
const usersTurn = () => (fen().split(" ")[1] === "w" ? "white" : "black") === color();

export default function RepertoirePanel() {
  const [mode, setMode] = createSignal<"low_memorization" | "sharp">("low_memorization");
  const [structure, setStructure] = createSignal("");
  const [opponent, setOpponent] = createSignal("");
  const state = (command: DirectCommand) => commandStates()[command];
  const rows = (command: DirectCommand, key: string) => ((state(command).result?.[key] as Record<string, unknown>[] | undefined) ?? []);
  const commandButton = (command: DirectCommand, label: string, args: () => Record<string, unknown> = () => ({})) => (
    <Show when={state(command).status === "running"} fallback={<button class="scan-btn" onClick={(e) => (e.preventDefault(), void executeCommand(command, {
      ...args(),
      ...(["audit_repertoire_moves", "find_only_moves", "export_annotated_repertoire"].includes(command) ? { depth: analysisDepth() } : {}),
    }))}>{label}</button>}>
      <button class="scan-btn" onClick={(e) => (e.preventDefault(), cancelCommand(command))}>Cancel</button>
    </Show>
  );
  const commandStatus = (command: DirectCommand) => <>
    <Show when={state(command).progress}>{(p) => <div class="scan-progress">
      <progress class="scan-meter" max={p().total || 1} value={p().total ? Math.min(p().done, p().total!) : undefined} />
      <span>{p().detail ?? "working"} {p().total ? `${p().done}/${p().total}` : "…"}</span>
    </div>}</Show>
    <Show when={state(command).error}><div class="empty">{state(command).error}</div></Show>
  </>;

  const navSan = (sans: string[]) => {
    const ip = currentTree().indexPathOfSan(sans);
    if (ip) actions.goto(ip);
  };

  const pickReplacement = (res: ReplacementResult, pivotMove: string) => {
    const fromPath = currentTree().indexPathOfSan(res.pivot_path.slice(0, -1));
    if (!fromPath) return;
    actions.goto(fromPath); // jump there so the gold preview arrow is visible immediately
    stagePreviewLine(fromPath, [pivotMove]);
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
  const cpDelta = (d: number | null) => (d == null ? "" : ` Δ${d <= 0 ? "+" : "−"}${(Math.abs(d) / 100).toFixed(2)}`);

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
    <div class="rep-row indent fill-row" onClick={() => onFill(props.g, props.opt)}>
      <span class="san">{numbered(props.opt.line, props.g.path.length)}</span>
      <span class="ev">{props.opt.evalCp == null ? "—" : cp2(props.opt.evalCp)}</span>
      <span class="fit">{props.label} · fit {props.opt.fit.toFixed(2)}</span>
    </div>
  );

  return (
    <div class="rep-panel">
      <div class="outcome-label">Repertoire</div>
      <div class="scope-note">Engine-backed operations use depth {analysisDepth()}.</div>
      <section class="strategic-fit-entry" aria-labelledby="strategic-fit-entry-title">
        <div>
          <div id="strategic-fit-entry-title" class="strategic-fit-entry-title">Strategic Fit</div>
          <div class="strategic-fit-entry-copy">
            Explore the review workspace. Opening it does not analyze or change this repertoire.
          </div>
        </div>
        <button
          type="button"
          class="strategic-fit-open-button"
          onClick={() => setStrategicFitWorkspaceOpen(true)}
        >Open workspace</button>
      </section>
      <Show when={preview()}>{(active) => (
        <div class="rep-preview" role="status" aria-label="Staged repertoire line">
          <div class="rep-preview-label">Staged line</div>
          <div class="rep-preview-line">{numbered(active().sans, active().fromPath.length)}</div>
          <div class="rep-preview-actions">
            <button class="accept" onClick={acceptPreview}>Accept line</button>
            <button class="reject" onClick={clearPreview}>Cancel</button>
          </div>
        </div>
      )}</Show>
      <details class="rep-section">
        <summary><span>Prescribed-move audit</span>{commandButton("audit_repertoire_moves", "Audit")}</summary>
        <div class="scope-note">Up to 20 positions · depth {analysisDepth()} · local engine</div>
        {commandStatus("audit_repertoire_moves")}
        <For each={rows("audit_repertoire_moves", "findings")}>{(finding) => (
          <div class="rep-row" onClick={() => navSan(finding.path as string[])}>
            <span class={`sev sev-${String(finding.classification)}`}>{String(finding.classification)}</span>
            <span class="san">{(finding.path as string[]).join(" ")} · {String(finding.prescribed)} → {String(finding.best_move)}</span>
            <span class="ev">−{(Number(finding.cp_loss) / 100).toFixed(2)}</span>
          </div>
        )}</For>
      </details>

      <details class="rep-section">
        <summary><span>Only moves & drills</span>{commandButton("find_only_moves", "Find", () => ({ max_positions: 60 }))}</summary>
        <div class="scope-note">Up to 60 positions · depth {analysisDepth()} · cancellable</div>
        {commandStatus("find_only_moves")}
        <For each={rows("find_only_moves", "findings")}>{(finding) => (
          <div class="rep-row" onClick={() => navSan(finding.path as string[])}>
            <span class="bridge-icon">!</span><span class="san">{(finding.path as string[]).join(" ") || "Start"} · {String(finding.best_move)}</span>
            <span class="fit">margin {Number(finding.margin)}cp</span>
          </div>
        )}</For>
        <Show when={state("find_only_moves").status === "completed"}>
          <button class="fix-btn" onClick={() => void executeCommand("find_only_moves", { max_positions: 60, export_deck: true, depth: analysisDepth() })}>Generate CSV deck</button>
        </Show>
        <Show when={(state("find_only_moves").result?.deck as Record<string, unknown> | undefined)?.artifact_id}>
          {(id) => <button class="fix-btn" onClick={() => saveArtifact(String(id()))}>Save CSV deck</button>}
        </Show>
      </details>

      <details class="rep-section">
        <summary><span>Structure search</span>{commandButton("find_structures", "Search", () => ({ structure: structure() }))}</summary>
        <div class="command-input"><input value={structure()} placeholder="e.g. Carlsbad" onInput={(e) => setStructure(e.currentTarget.value)} /></div>
        {commandStatus("find_structures")}
        <For each={rows("find_structures", "matches")}>{(match) => (
          <div class="rep-row" onClick={() => navSan(match.path as string[])}><span class="san">{(match.path as string[]).join(" ")}</span><span class="fit">{String(match.structure)}</span></div>
        )}</For>
      </details>

      <details class="rep-section">
        <summary><span>Opponent preparation</span>{commandButton("prep_vs_opponent", "Prepare", () => ({ username: opponent() }))}</summary>
        <div class="command-input"><input value={opponent()} placeholder="Lichess username" onInput={(e) => setOpponent(e.currentTarget.value)} /></div>
        {commandStatus("prep_vs_opponent")}
        <For each={rows("prep_vs_opponent", "lines")}>{(line) => <div class="rep-row"><span class="san">{String(line.name)}</span><span class="fit">{String(line.games)} games · {String(line.hit_rate)}% in prep</span></div>}</For>
      </details>

      <details class="rep-section">
        <summary><span>Annotated repertoire</span>{commandButton("export_annotated_repertoire", "Generate", () => ({ max_positions: 60 }))}</summary>
        <div class="scope-note">Audit, only moves, gaps, and congruence · up to 60 positions</div>
        {commandStatus("export_annotated_repertoire")}
        <Show when={state("export_annotated_repertoire").result?.artifact_id}>{(id) => <button class="fix-btn" onClick={() => saveArtifact(String(id()))}>Save annotated PGN</button>}</Show>
      </details>

      <StrategicFitTransfer />

      <div class="outcome-label">Advanced</div>
      {/* Tier A: gaps */}
      <details class="rep-section" open>
        <summary>
          <span>Gaps</span>
          <Show when={scanning()} fallback={<button class="scan-btn" onClick={(e) => (e.preventDefault(), void scanGaps())}>Scan</button>}>
            <button class="scan-btn" onClick={(e) => (e.preventDefault(), cancelScan())}>Cancel</button>
          </Show>
        </summary>
        <Show when={progress()}>{(p) => <div class="scan-progress">
          <span class={`scan-bar${p().total ? "" : " indeterminate"}`} role="progressbar"
            aria-label="Scanning repertoire positions" aria-valuemin="0"
            aria-valuemax={p().total || undefined} aria-valuenow={p().total ? Math.min(p().done, p().total) : undefined}>
            <span class="scan-bar-fill" style={{ width: p().total ? `${Math.min(100, Math.round((p().done / p().total) * 100))}%` : "38%" }} />
          </span>
          <span>{p().total ? `scanning ${p().done}/${p().total}…` : "preparing scan…"}</span>
        </div>}</Show>
        <Show when={scanError()}><div class="empty">{scanError()}</div></Show>
        <Show when={!scanning() && gaps().length === 0 && !scanError()}>
          <div class="empty">No scan yet — or no gaps.</div>
        </Show>
        <For each={gaps()}>
          {(g) => {
            const state = () => fills()[gapKey(g)];
            return (
              <div class="rep-flag">
                <div class="rep-row" onClick={() => actions.goto(g.path)} title={`${gapLine(g)} — uncovered: ${g.uncoveredMove}`}>
                  <span class={`sev sev-${g.severity}`}>{g.severity}</span>
                  <span class="san"><span class="muted">{gapLine(g)}</span> · {g.uncoveredMove}</span>
                  <span class="ev">{gapEval(g)}</span>
                </div>
                <button class="fix-btn fill-btn" onClick={() => void fillGap(g)}>Fill this</button>
                <Show when={state() === "loading"}><div class="scan-progress fill-progress">finding fills…</div></Show>
                <Show when={state() && typeof state() === "object" && "error" in (state() as object)}>
                  <div class="empty">{(state() as { error: string }).error}</div>
                </Show>
                <Show when={state() && typeof state() === "object" && "bestEval" in (state() as object)}>
                  <FillRow g={g} opt={(state() as GapFill).bestEval} label="best eval" />
                  <Show when={(state() as GapFill).bestFit}>
                    {(bf) => <FillRow g={g} opt={bf()} label={bf().fit > (state() as GapFill).bestEval.fit ? "best fit" : "alt"} />}
                  </Show>
                </Show>
              </div>
            );
          }}
        </For>
        {/* Replies that look uncovered but transpose into prep — false gaps, shown muted. */}
        <For each={covered()}>
          {(c: CoveredGap) => (
            <div class="rep-row covered" onClick={() => actions.goto(c.path)} title={`${c.uncoveredMove} transposes into ${c.joinsPath.join(" ")}`}>
              <span class="sev">✓</span>
              <span class="san">{c.uncoveredMove}</span>
              <span class="fit">covered → {c.joinsPath.at(-1)}</span>
            </div>
          )}
        </For>
      </details>

      {/* Tier A: congruence */}
      <details class="rep-section">
        <summary>
          <span>Congruence</span>
          <Show when={congScanning()} fallback={<button class="scan-btn" onClick={(e) => (e.preventDefault(), void scanCongruence())}>Scan</button>}>
            <span class="scan-progress">…</span>
          </Show>
        </summary>
        <Show when={congError()}><div class="empty">{congError()}</div></Show>
        <Show when={congruence() && congruence()!.length === 0}><div class="empty">No inconsistencies.</div></Show>
        <For each={congruence() ?? []}>
          {(f: CongruenceFlag) => {
            const key = () => f.paths[0]!.join(",");
            const state = () => replacements()[key()];
            return (
              <div class="rep-flag">
                <div class="rep-row" onClick={() => navSan(f.paths[0]!)} title={f.description}>
                  <span class={`sev sev-${f.severity}`}>{f.severity}</span>
                  <span class="ctype">{f.type.replace(/_/g, " ")}</span>
                  <span class="san">{f.paths[0]!.join(" ")}</span>
                </div>
                <button class="fix-btn" onClick={() => void fixFlag(f.paths[0]!)}>Fix this</button>
                <Show when={state() === "loading"}><div class="scan-progress">finding replacements…</div></Show>
                <Show when={state() && typeof state() === "object" && "error" in (state() as object)}>
                  <div class="empty">{(state() as { error: string }).error}</div>
                </Show>
                <Show when={state() && typeof state() === "object" && "suggestions" in (state() as object)}>
                  <For each={(state() as ReplacementResult).suggestions}>
                    {(rm) => (
                      <div class="rep-row indent" onClick={() => pickReplacement(state() as ReplacementResult, rm.pivot_move)}>
                        <span class="san">{rm.pivot_move}</span>
                        <span class="ev">{cp2(rm.eval_cp)}</span>
                        <span class="fit">fit {rm.profile_match}</span>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            );
          }}
        </For>
      </details>

      {/* Tier A: connect dangling stubs into prep (engine-vetted) */}
      <details class="rep-section">
        <summary>
          <span>Connect</span>
          <Show when={bridgeScanning()} fallback={<button class="scan-btn" onClick={(e) => (e.preventDefault(), void scanBridges())}>Scan</button>}>
            <span class="scan-progress">…</span>
          </Show>
        </summary>
        <Show when={bridgeError()}><div class="empty">{bridgeError()}</div></Show>
        <Show when={extBridges() && extBridges()!.length === 0}>
          <div class="empty">No stubs that rejoin prep.</div>
        </Show>
        {/* A stopped line continued by the color's engine-best moves until it rejoins existing prep. */}
        <For each={extBridges() ?? []}>
          {(b: ExtendedBridge) => (
            <div class="rep-row" onClick={() => onExtBridge(b)} title={`${b.fromPath.join(" ")} → ${b.moves.join(" ")}  joins  ${b.joinsPath.join(" ")}`}>
              <span class="bridge-icon">🔗</span>
              <span class="san">{b.fromPath.join(" ")} → {b.moves.join(" ")}</span>
              <span class="fit">joins {b.joinsPath.at(-1)}</span>
            </div>
          )}
        </For>
      </details>

      {/* Tier A: shorten a line via an engine-vetted transposition (find_pruning_transpositions) */}
      <details class="rep-section">
        <summary>
          <span>Shorten</span>
          <Show when={pruneScanning()} fallback={<button class="scan-btn" onClick={(e) => (e.preventDefault(), void scanPrune())}>Scan</button>}>
            <span class="scan-progress" title="positions analysed / estimated total">
              <span class="scan-bar">
                <span class="scan-bar-fill" style={{ width: `${pruneTotal() ? Math.min(100, Math.round((pruneDone() / pruneTotal()) * 100)) : 0}%` }} />
              </span>
              {pruneTotal() ? `${Math.min(pruneDone(), pruneTotal())}/${pruneTotal()}` : "…"}
              <button class="scan-btn scan-cancel" title="Cancel scan" onClick={(e) => (e.preventDefault(), cancelPrune())}>✕</button>
            </span>
          </Show>
        </summary>
        <Show when={pruneError()}><div class="empty">{pruneError()}</div></Show>
        <Show when={pruneSuggestions() && pruneSuggestions()!.length === 0}><div class="empty">No shortenable lines.</div></Show>
        <For each={pruneSuggestions() ?? []}>
          {(p: PruneSuggestion) => (
            <>
              <div
                class="rep-row"
                onClick={() => onPrune(p)}
                title={`${p.linePath.join(" ")}\n@ ${p.atPath.join(" ") || "start"} play ${p.rerouteMove} → joins ${p.joinsPath.join(" ")} (save ${p.savedPlies} ply${cpDelta(p.evalDelta)})${p.bestSavings ? "\n★ most moves saved on this line" : ""}${p.bestEval ? `\n★ best eval on this line${p.evalConfirmed ? " (deep-confirmed)" : ""}` : ""}`}
              >
                <span class="bridge-icon">✂</span>
                <span class="san">{p.atPath.join(" ")} → {p.rerouteMove}</span>
                <Show when={p.bestSavings}><span class="pick-badge sav" title="most moves saved on this line">↓</span></Show>
                <Show when={p.bestEval}><span class="pick-badge eval" title={`best eval on this line${p.evalConfirmed ? " (deep-confirmed)" : ""}`}>★</span></Show>
                <span class="fit">−{p.savedPlies}ply{cpDelta(p.evalDelta)}</span>
                <button
                  class={`inspect-btn${inspectKey() === shortcutKey(p) ? " on" : ""}`}
                  title="Inspect: quality (eval + fit) and coverage safety"
                  onClick={(e) => (e.stopPropagation(), void inspectShortcut(p))}
                >?</button>
              </div>
              <Show when={inspectKey() === shortcutKey(p)}>
                <div class="shortcut-detail">
                  <Show when={inspecting()}><span class="empty">checking…</span></Show>
                  <Show when={inspectError()}><span class="empty">{inspectError()}</span></Show>
                  <Show when={comparison()}>
                    {(c) => (
                      <div>
                        <div>
                          quality: <b>{c().recommend === "transpose" ? "take shortcut" : "keep line"}</b>{" "}
                          <span class="muted">({c().basis}{c().eval_disagrees_with_fit ? ", eval/fit disagree" : ""})</span>
                        </div>
                        <div class="muted">
                          evalΔ {c().evalDelta == null ? "?" : (c().evalDelta! / 100).toFixed(2)} · fit {c().fitStay}→{c().fitTranspose} · {c().structureStay}→{c().structureTranspose}
                        </div>
                        {/* fit weak: the two branches' blended fit is within a rounding-width, so it
                            can't separate them — size-robust, unlike an absolute low-fit cutoff (a
                            large repertoire's on-theme leaves score lower than a small one's). */}
                        <Show when={Math.abs(c().fitStay - c().fitTranspose) < 0.05}>
                          <div class="warn">fit weak — branches resemble the repertoire about equally</div>
                        </Show>
                      </div>
                    )}
                  </Show>
                  <Show when={coverage()}>
                    {(cov) => (
                      <div class={cov().introduces_gap ? "warn" : "safe"}>
                        {cov().introduces_gap ? `⚠ opens ${cov().new_gaps.length} new gap${cov().new_gaps.length === 1 ? "" : "s"}` : "✓ coverage-safe"}
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
          <select class="rep-mode" value={mode()} onClick={(e) => e.stopPropagation()} onChange={(e) => setMode(e.currentTarget.value as "low_memorization" | "sharp")}>
            <option value="low_memorization">low-mem</option>
            <option value="sharp">sharp</option>
          </select>
          <button class="scan-btn" disabled={!usersTurn()} onClick={(e) => (e.preventDefault(), void scanComplementary(mode()))}>Suggest</button>
        </summary>
        <Show when={!usersTurn()}><div class="empty">Navigate to your move to extend from here.</div></Show>
        <Show when={compScanning()}><div class="scan-progress">searching…</div></Show>
        <Show when={compError()}><div class="empty">{compError()}</div></Show>
        <For each={complementary() ?? []}>
          {(m) => (
            <div class="rep-row" onClick={() => stagePreviewLine(currentPath(), [m.move])} title={m.pv}>
              <span class="san">{m.move}</span>
              <span class="ev">{cp2(m.eval)}</span>
              <span class="fit">{m.profile_match != null ? `fit ${m.profile_match}` : m.sharpness != null ? `sharp ${m.sharpness}` : ""}</span>
            </div>
          )}
        </For>
      </details>
    </div>
  );
}
