/**
 * RepertoirePanel (Feature 6): the no-API repertoire backbone. Collapsible sections —
 * Tier A scans (Gaps, Congruence) whose rows navigate to the flagged line, and Tier B actions
 * (Extend, Fix) whose rows stage a preview line (gold arrow + Accept, reusing Feature 1).
 * Everything runs on the local engine / pure tree math; chat is the interpretive layer on top.
 */
import { For, Show, createSignal } from "solid-js";
import { gaps, covered, scanning, progress, scanError, scanGaps, cancelScan, type Gap, type CoveredGap } from "../store/gaps";
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
  type CongruenceFlag,
  type ReplacementResult,
} from "../store/repertoire";
import type { ExtendedBridge, PruneSuggestion } from "@chess-mcp/chess-tools";
import { stagePreviewLine } from "../store/suggestions";
import { actions, currentTree, currentPath, fen, color } from "../store/game";

function gapEval(g: Gap): string {
  if (g.mate !== null) return `M${Math.abs(g.mate)}`;
  const cp = g.evalCp ?? 0;
  return (cp >= 0 ? "+" : "") + (cp / 100).toFixed(2);
}
const cp2 = (cp: number) => (cp >= 0 ? "+" : "") + (cp / 100).toFixed(2);
const usersTurn = () => (fen().split(" ")[1] === "w" ? "white" : "black") === color();

export default function RepertoirePanel() {
  const [mode, setMode] = createSignal<"low_memorization" | "sharp">("low_memorization");

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

  return (
    <div class="rep-panel">
      {/* Tier A: gaps */}
      <details class="rep-section" open>
        <summary>
          <span>Gaps</span>
          <Show when={scanning()} fallback={<button class="scan-btn" onClick={(e) => (e.preventDefault(), void scanGaps())}>Scan</button>}>
            <button class="scan-btn" onClick={(e) => (e.preventDefault(), cancelScan())}>Cancel</button>
          </Show>
        </summary>
        <Show when={progress()}>{(p) => <div class="scan-progress">scanning {p().done}/{p().total}…</div>}</Show>
        <Show when={scanError()}><div class="empty">{scanError()}</div></Show>
        <Show when={!scanning() && gaps().length === 0 && !scanError()}>
          <div class="empty">No scan yet — or no gaps.</div>
        </Show>
        <For each={gaps()}>
          {(g) => (
            <div class="rep-row" onClick={() => actions.goto(g.path)}>
              <span class={`sev sev-${g.severity}`}>{g.severity}</span>
              <span class="san">{g.uncoveredMove}</span>
              <span class="ev">{gapEval(g)}</span>
            </div>
          )}
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
            </div>
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
