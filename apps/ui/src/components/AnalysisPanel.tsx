/**
 * AnalysisPanel: the top-N engine lines for the current position, each tagged with its
 * repertoire fit (green/yellow/red) and your-side eval. Mirrors the board arrows.
 */
import { For, Show, createEffect } from "solid-js";
import type { Path } from "@chess-mcp/chess-tools";
import { analysisState, engineLines, reloadAnalysis, setEvalEnabled } from "../store/analysis";
import { cloud } from "../store/cloud";
import { suggestions, acceptSuggestion, rejectSuggestion } from "../store/suggestions";
import { actions, currentPath, currentTree } from "../store/game";
import { lastNavigationSource, setLastNavigationSource } from "../store/ui";
import { analysisDepth } from "../store/engine-settings";
import { ANALYSIS_CONTENT } from "../content/analysis";
import AnalysisSettings from "./AnalysisSettings";
import ArrowLegend from "./ArrowLegend";
import PanelHeader from "./primitives/PanelHeader";
import Progress from "./primitives/Progress";
import Status from "./primitives/Status";
import { cloudEvaluationText, evaluationText } from "../content/format";

export default function AnalysisPanel() {
  const state = analysisState;
  const inFlight = () => state() === "starting" || state() === "analysing";

  /*
   * WP-028 AC-3: any navigation that is not a card's own `Go to line` clears the marker.
   *
   * The effect tracks the path signal and compares against the path recorded when the marker was
   * set. A card sets both in the same tick, so its own navigation is a no-op here; a move-tree
   * click or an arrow key changes the path without updating the record, and the marker clears.
   */
  let markedPath: Path | null = null;
  createEffect(() => {
    const path = currentPath();
    const source = lastNavigationSource();
    if (source === null) {
      markedPath = null;
      return;
    }
    if (markedPath === null) {
      markedPath = path;
      return;
    }
    if (markedPath !== path) {
      markedPath = null;
      setLastNavigationSource(null);
    }
  });

  return (
    <div class="analysis">
      <PanelHeader class="analysis-header" title={ANALYSIS_CONTENT.title}>
        <span class="analysis-header-meta">
          <span class={`analysis-state analysis-state-${state()}`}>
            {ANALYSIS_CONTENT.status[state()]}
          </span>
          <span
            class="analysis-depth-chip"
            aria-label={`Effective analysis depth: ${analysisDepth()}`}
          >
            Depth {analysisDepth()}
          </span>
        </span>
        <AnalysisSettings />
      </PanelHeader>
      <Show when={inFlight()}>
        <Progress class="analysis-progress" label={ANALYSIS_CONTENT.progress} />
      </Show>
      <Show
        when={engineLines().length}
        fallback={
          <div class={`analysis-empty analysis-empty-${state()}`}>
            <p>{ANALYSIS_CONTENT.empty[state()]}</p>
            <Show when={state() === "off"}>
              <button type="button" onClick={() => setEvalEnabled(true)}>
                {ANALYSIS_CONTENT.actions.enable}
              </button>
            </Show>
            <Show when={state() === "offline"}>
              <button type="button" onClick={reloadAnalysis}>
                {ANALYSIS_CONTENT.actions.reload}
              </button>
            </Show>
          </div>
        }
      >
        <For each={engineLines()}>
          {(l) => (
            <div class="line">
              <Status class={`fit fit-${l.fit}`}>
                {ANALYSIS_CONTENT.arrows.fit[l.fit].plain}
                <span class="fit-expert"> ({ANALYSIS_CONTENT.arrows.fit[l.fit].expert})</span>
              </Status>
              <span class="san">{l.san}</span>
              <span
                class={`weight w-${l.weight}`}
                role="img"
                aria-label={`Engine arrow strength: ${ANALYSIS_CONTENT.arrows.weight[l.weight].plain} (${ANALYSIS_CONTENT.arrows.weight[l.weight].expert})`}
              />
              <span class="ev">{evaluationText(l)}</span>
            </div>
          )}
        </For>
      </Show>
      <ArrowLegend />
      <div class="cloud-row" title="Lichess cloud eval (white POV)">
        <span class="cloud-label">cloud</span>
        <span class="cloud-val">{cloudEvaluationText(cloud())}</span>
      </div>

      <Show when={suggestions().length}>
        <div class="suggestions">
          <PanelHeader title="Suggested (from chat)" />
          <For each={suggestions()}>
            {(s) => (
              <div class="suggestion">
                <div class="sug-line">{s.sans.join(" ")}</div>
                <Show when={s.comment}>
                  <div class="sug-comment">{s.comment}</div>
                </Show>
                <div class="sug-actions">
                  {/*
                    WP-028 AC-1: navigating from a card marks it, and AC-3 clears the marker when
                    anything else moves the board — the effect below watches the path signal, so
                    only a navigation that re-sets the marker in the same tick keeps it.
                  */}
                  <button
                    class="sug-goto"
                    data-suggestion-goto={s.id}
                    onClick={() => {
                      const target = currentTree().indexPathOfSan([
                        ...currentTree().sanPathAt(s.fromPath),
                        ...s.sans,
                      ]);
                      actions.goto(target ?? s.fromPath);
                      setLastNavigationSource({ kind: "chat", id: s.id });
                    }}
                  >
                    Go to line
                  </button>
                  <Show when={lastNavigationSource()?.id === s.id}>
                    <span class="sug-showing" data-showing-on-board role="status">
                      Showing on board
                    </span>
                  </Show>
                  <Show when={s.sourceMessageIndex != null}>
                    <button
                      class="sug-source"
                      data-suggestion-source={s.sourceMessageIndex}
                      onClick={() => {
                        const element = document.getElementById(
                          `chat-message-${s.sourceMessageIndex}`,
                        );
                        element?.scrollIntoView({ block: "center" });
                        element?.focus();
                      }}
                    >
                      Show the message this came from
                    </button>
                  </Show>
                  <button
                    class="accept"
                    onClick={() => {
                      acceptSuggestion(s.id);
                    }}
                  >
                    Accept
                  </button>
                  <button
                    class="reject"
                    onClick={() => {
                      rejectSuggestion(s.id);
                    }}
                  >
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
