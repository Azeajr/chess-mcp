/**
 * AnalysisPanel: the top-N engine lines for the current position, each tagged with its
 * repertoire fit (green/yellow/red) and your-side eval. Mirrors the board arrows.
 */
import { For, Show } from "solid-js";
import { analysisState, engineLines, reloadAnalysis, setEvalEnabled } from "../store/analysis";
import { cloud } from "../store/cloud";
import { suggestions, acceptSuggestion, rejectSuggestion } from "../store/suggestions";
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
