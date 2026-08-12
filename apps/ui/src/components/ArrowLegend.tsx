import { createSignal, For, onMount } from "solid-js";
import { ANALYSIS_CONTENT } from "../content/analysis";

export const ARROW_LEGEND_STORAGE_KEY = "chess.analysis.arrow-legend.expanded.v1";

export default function ArrowLegend() {
  const [expanded, setExpanded] = createSignal(false);

  onMount(() => setExpanded(localStorage.getItem(ARROW_LEGEND_STORAGE_KEY) === "true"));

  const persist = (event: ToggleEvent) => {
    const open = (event.currentTarget as HTMLDetailsElement).open;
    setExpanded(open);
    localStorage.setItem(ARROW_LEGEND_STORAGE_KEY, String(open));
  };

  return (
    <details class="arrow-legend" open={expanded()} onToggle={persist}>
      <summary>{ANALYSIS_CONTENT.arrows.summary}</summary>
      <div class="arrow-legend-body">
        <section aria-labelledby="arrow-fit-heading">
          <h3 id="arrow-fit-heading">{ANALYSIS_CONTENT.arrows.fitHeading}</h3>
          <ul>
            <For each={Object.entries(ANALYSIS_CONTENT.arrows.fit)}>
              {([fit, label]) => (
                <li>
                  <span class={`legend-colour legend-fit-${fit}`} aria-hidden="true" />
                  {label.plain} <span class="legend-expert">({label.expert})</span>
                </li>
              )}
            </For>
          </ul>
        </section>
        <section aria-labelledby="arrow-weight-heading">
          <h3 id="arrow-weight-heading">{ANALYSIS_CONTENT.arrows.weightHeading}</h3>
          <ul>
            <For each={Object.entries(ANALYSIS_CONTENT.arrows.weight)}>
              {([weight, label]) => (
                <li>
                  <span class={`legend-line engine w-${weight}`} aria-hidden="true" />
                  {label.plain} <span class="legend-expert">({label.expert})</span>
                </li>
              )}
            </For>
          </ul>
        </section>
        <section aria-labelledby="arrow-source-heading">
          <h3 id="arrow-source-heading">{ANALYSIS_CONTENT.arrows.sourceHeading}</h3>
          <ul>
            <li>
              <span class="legend-line repertoire" aria-hidden="true" />
              {ANALYSIS_CONTENT.arrows.source.repertoire}
            </li>
            <li>
              <span class="legend-line engine w-medium" aria-hidden="true" />
              {ANALYSIS_CONTENT.arrows.source.engine}
            </li>
          </ul>
        </section>
      </div>
    </details>
  );
}
