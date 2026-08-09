import { Show } from "solid-js";
import { ANALYSIS_CONTENT, CLOUD_EVALUATION_PRIVACY_NOTE } from "../content/analysis";
import {
  MAX_ANALYSIS_DEPTH,
  MIN_ANALYSIS_DEPTH,
  analysisDepth,
  setAnalysisDepth,
} from "../store/engine-settings";
import { evalEnabled, setEvalEnabled } from "../store/analysis";
import { cloudEvalEnabled, setCloudEvalEnabled } from "../store/settings";

const updateDepth = (depth: number) => {
  setAnalysisDepth(depth);
};

export default function AnalysisSettings() {
  return (
    <details class="analysis-settings">
      <summary>{ANALYSIS_CONTENT.settings.summary}</summary>
      <div class="analysis-settings-body">
        <label class="analysis-setting analysis-evaluation-setting">
          <span>{ANALYSIS_CONTENT.settings.evaluation}</span>
          <input
            type="checkbox"
            role="switch"
            aria-label={ANALYSIS_CONTENT.settings.evaluation}
            checked={evalEnabled()}
            onChange={(event) => {
              setEvalEnabled(event.currentTarget.checked);
            }}
          />
        </label>

        <label
          class="analysis-setting analysis-depth-control"
          title="Analysis depth for engine-backed position, game, and repertoire operations"
        >
          <span>{ANALYSIS_CONTENT.settings.depth}</span>
          <div class="analysis-depth-inputs">
            <input
              aria-label={ANALYSIS_CONTENT.settings.depthSlider}
              type="range"
              min={MIN_ANALYSIS_DEPTH}
              max={MAX_ANALYSIS_DEPTH}
              value={analysisDepth()}
              onInput={(event) => {
                updateDepth(event.currentTarget.valueAsNumber);
              }}
            />
            <input
              class="analysis-depth-number"
              aria-label={ANALYSIS_CONTENT.settings.depth}
              type="number"
              min={MIN_ANALYSIS_DEPTH}
              max={MAX_ANALYSIS_DEPTH}
              value={analysisDepth()}
              onInput={(event) => {
                updateDepth(event.currentTarget.valueAsNumber);
              }}
              onWheel={(event) => {
                event.preventDefault();
                updateDepth(analysisDepth() + (event.deltaY < 0 ? 1 : -1));
              }}
            />
          </div>
          <Show when={analysisDepth() >= 25}>
            <small class="analysis-depth-helper">
              {ANALYSIS_CONTENT.settings.deepAnalysisHelper(analysisDepth())}
            </small>
          </Show>
        </label>

        <label class="analysis-setting analysis-cloud-setting">
          <span>{ANALYSIS_CONTENT.settings.cloudEvaluation}</span>
          <input
            type="checkbox"
            aria-label={ANALYSIS_CONTENT.settings.cloudEvaluation}
            checked={cloudEvalEnabled()}
            onChange={(event) => {
              setCloudEvalEnabled(event.currentTarget.checked);
            }}
          />
          <small>{CLOUD_EVALUATION_PRIVACY_NOTE}</small>
        </label>
      </div>
    </details>
  );
}
