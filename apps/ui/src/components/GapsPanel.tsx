/**
 * GapsPanel: on-demand completeness scan. Lists uncovered strong opponent replies ranked by
 * severity; clicking a gap navigates to that decision node so the user can add the missing line.
 */
import { For, Show } from "solid-js";
import { gaps, scanning, progress, scanError, scanGaps, cancelScan, type Gap } from "../store/gaps";
import { actions } from "../store/game";

function evalText(g: Gap): string {
  if (g.mate !== null) return `M${Math.abs(g.mate)}`;
  const cp = g.evalCp ?? 0;
  return (cp >= 0 ? "+" : "") + (cp / 100).toFixed(2);
}

export default function GapsPanel() {
  return (
    <div class="gaps">
      <div class="panel-head">
        <span>Repertoire gaps</span>
        <Show
          when={scanning()}
          fallback={
            <button class="scan-btn" onClick={() => void scanGaps()}>
              Scan
            </button>
          }
        >
          <button class="scan-btn" onClick={cancelScan}>
            Cancel
          </button>
        </Show>
      </div>

      <Show when={progress()}>
        {(p) => (
          <div class="scan-progress">
            scanning {p().done}/{p().total} positions…
          </div>
        )}
      </Show>
      <Show when={scanError()}>
        <div class="empty">{scanError()}</div>
      </Show>

      <Show when={!scanning() && !progress()}>
        <Show
          when={gaps().length}
          fallback={<div class="empty">No scan yet — or no gaps at this depth.</div>}
        >
          <For each={gaps()}>
            {(g) => (
              <div class="gap" onClick={() => actions.goto(g.path)}>
                <span class={`sev sev-${g.severity}`}>{g.severity}</span>
                <span class="san">{g.uncoveredMove}</span>
                <span class="ev">{evalText(g)}</span>
              </div>
            )}
          </For>
        </Show>
      </Show>
    </div>
  );
}
