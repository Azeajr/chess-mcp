/**
 * AnalysisPanel: the top-N engine lines for the current position, each tagged with its
 * repertoire fit (green/yellow/red) and your-side eval. Mirrors the board arrows.
 */
import { For, Show } from "solid-js";
import { engineLines, analysing, engineOffline, type EngineLine } from "../store/analysis";
import type { Fit } from "@chess-mcp/chess-tools";

const FIT_LABEL: Record<Fit, string> = { "in-book": "book", adjacent: "adj", out: "out" };

function evalText(l: EngineLine): string {
  if (l.mate !== null) return `M${Math.abs(l.mate)}`;
  const cp = l.cp ?? 0;
  return (cp >= 0 ? "+" : "") + (cp / 100).toFixed(2);
}

export default function AnalysisPanel() {
  return (
    <div class="analysis">
      <div class="panel-head">
        <span>Engine lines</span>
        <Show when={analysing()}>
          <span class="spinner">analysing…</span>
        </Show>
      </div>
      <Show
        when={!engineOffline()}
        fallback={<div class="empty">Engine offline — arrows unavailable.</div>}
      >
        <Show when={engineLines().length} fallback={<div class="empty">No lines yet.</div>}>
          <For each={engineLines()}>
            {(l) => (
              <div class="line">
                <span class={`fit fit-${l.fit}`}>{FIT_LABEL[l.fit]}</span>
                <span class="san">{l.san}</span>
                <span class={`weight w-${l.weight}`} title={`engine weight: ${l.weight}`} />
                <span class="ev">{evalText(l)}</span>
              </div>
            )}
          </For>
        </Show>
      </Show>
    </div>
  );
}
