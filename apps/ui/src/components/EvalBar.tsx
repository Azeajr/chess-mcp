/**
 * EvalBar: white-POV score of the current position, taken from the top engine line in the
 * analysis store (one engine consumer — no second search racing the arrows). Shows a neutral
 * bar until the first line arrives, "—" if the engine is offline.
 */
import { createMemo, Show } from "solid-js";
import { engineLines, engineOffline } from "../store/analysis";

const top = createMemo(() => engineLines()[0] ?? null);

function pct(): number {
  const e = top();
  if (!e) return 50;
  if (e.mate !== null) return e.mate > 0 ? 100 : 0;
  return Math.max(2, Math.min(98, 50 + (e.cp ?? 0) / 20));
}

function label(): string {
  const e = top();
  if (!e) return "";
  if (e.mate !== null) return `M${Math.abs(e.mate)}`;
  const cp = e.cp ?? 0;
  return (cp >= 0 ? "+" : "") + (cp / 100).toFixed(1);
}

export default function EvalBar() {
  return (
    <div class="eval-bar" title={engineOffline() ? "engine offline" : "Stockfish (white POV)"}>
      <div class="fill" style={{ height: `${pct()}%` }} />
      <div class="score">
        <Show when={!engineOffline()} fallback="—">
          {label()}
        </Show>
      </div>
    </div>
  );
}
