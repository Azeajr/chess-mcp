/**
 * AnalysisPanel: the top-N engine lines for the current position, each tagged with its
 * repertoire fit (green/yellow/red) and your-side eval. Mirrors the board arrows.
 */
import { For, Show } from "solid-js";
import { engineLines, analysing, engineOffline, type EngineLine } from "../store/analysis";
import { cloud } from "../store/cloud";
import { suggestions, acceptSuggestion, rejectSuggestion } from "../store/suggestions";
import type { Fit } from "@chess-mcp/chess-tools";

const FIT_LABEL: Record<Fit, string> = { "in-book": "book", adjacent: "adj", out: "out" };

function evalText(l: EngineLine): string {
  if (l.mate !== null) return `M${Math.abs(l.mate)}`;
  const cp = l.cp ?? 0;
  return (cp >= 0 ? "+" : "") + (cp / 100).toFixed(2);
}

function cloudText(): string {
  const c = cloud();
  if (!c) return "—";
  const score = c.mate !== null ? `M${Math.abs(c.mate)}` : (c.cp! >= 0 ? "+" : "") + (c.cp! / 100).toFixed(2);
  return `${score}  ·  depth ${c.depth}`;
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
      <div class="cloud-row" title="Lichess cloud eval (white POV)">
        <span class="cloud-label">cloud</span>
        <span class="cloud-val">{cloudText()}</span>
      </div>

      <Show when={suggestions().length}>
        <div class="suggestions">
          <div class="panel-head">Suggested (from chat)</div>
          <For each={suggestions()}>
            {(s) => (
              <div class="suggestion">
                <div class="sug-line">{s.sans.join(" ")}</div>
                <Show when={s.comment}>
                  <div class="sug-comment">{s.comment}</div>
                </Show>
                <div class="sug-actions">
                  <button class="accept" onClick={() => acceptSuggestion(s.id)}>
                    Accept
                  </button>
                  <button class="reject" onClick={() => rejectSuggestion(s.id)}>
                    Reject
                  </button>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
