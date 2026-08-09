/**
 * EvalBar: white-POV score of the current position, taken from the top engine line in the
 * analysis store (one engine consumer — no second search racing the arrows). Shows a neutral
 * bar until the first line arrives, "—" if the engine is offline.
 */
import { createMemo } from "solid-js";
import { evaluationAriaLabel } from "../content/analysis";
import { analysisState, engineLines } from "../store/analysis";

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

  return (
    <div
      class={`eval-bar${state() === "off" ? " is-off" : ""}`}
      role="img"
      aria-label={evaluationAriaLabel(state(), top())}
      title={state() === "offline" ? "engine offline" : "Stockfish (white POV)"}
    >
      <div class="fill" style={{ height: `${pct(top())}%` }} />
      <div class="score">{state() === "offline" ? "—" : label(top())}</div>
    </div>
  );
}
