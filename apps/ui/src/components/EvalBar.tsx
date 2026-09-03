/**
 * EvalBar: white-POV score of the current position, taken from the top engine line in the
 * analysis store (one engine consumer — no second search racing the arrows). Shows a neutral
 * bar until the first line arrives, "—" if the engine is offline.
 *
 * While evaluation is off the bar is the switch that turns it on. It is the element that shows
 * the evaluation, so it is the element a user points at when they want one; routing that through
 * the Engine panel's button made the bar a dead decoration sitting beside a live board. Off state
 * therefore draws no fill at all — a half-filled grey column read as a rendering fault, not as
 * "no data".
 */
import { createMemo, Show } from "solid-js";
import { evaluationAriaLabel } from "../content/analysis";
import { analysisState, engineLines, setEvalEnabled } from "../store/analysis";

function pct(e: ReturnType<typeof engineLines>[number] | null): number {
  if (!e) return 50;
  if (e.mate !== null) return e.mate > 0 ? 100 : 0;
  return Math.max(2, Math.min(98, 50 + (e.cp ?? 0) / 20));
}

function label(e: ReturnType<typeof engineLines>[number] | null): string {
  if (!e) return "";
  if (e.mate !== null) return `M${Math.abs(e.mate)}`;
  const cp = e.cp ?? 0;
  return (cp >= 0 ? "+" : "") + (cp / 100).toFixed(1);
}

export default function EvalBar() {
  const top = createMemo(() => engineLines()[0] ?? null);
  const state = analysisState;
  const off = () => state() === "off";

  return (
    <Show
      when={off()}
      fallback={
        <div
          class="eval-bar"
          role="img"
          aria-label={evaluationAriaLabel(state(), top())}
          title={state() === "offline" ? "engine offline" : "Stockfish (white POV)"}
        >
          <div class="fill" style={{ height: `${pct(top())}%` }} />
          <div class="score">{state() === "offline" ? "—" : label(top())}</div>
        </div>
      }
    >
      <button
        type="button"
        class="eval-bar is-off"
        aria-label="Evaluation is off. Turn on engine evaluation."
        title="Evaluation is off — click to turn it on"
        onClick={() => {
          setEvalEnabled(true);
        }}
      >
        {/* Kept in the tree at zero height: it is the app's canonical transition probe. */}
        <div class="fill" style={{ height: "0%" }} />
        <div class="eval-bar-off-mark" aria-hidden="true" />
      </button>
    </Show>
  );
}
