/**
 * EvalBar: white-POV engine score for the current position. Debounced; latest FEN wins.
 * Shows "offline" if stockfish.js didn't load — the rest of the app works regardless.
 */
import { createSignal, createEffect, onCleanup, Show } from "solid-js";
import { fen } from "../store/game";
import { analyse, type Eval } from "../engine/stockfish";

function pct(ev: Eval): number {
  if (ev.mate !== null) return ev.mate > 0 ? 100 : 0;
  const cp = ev.cp ?? 0;
  // Logistic-ish clamp to keep the bar readable.
  return Math.max(2, Math.min(98, 50 + cp / 20));
}

function label(ev: Eval): string {
  if (ev.mate !== null) return `M${Math.abs(ev.mate)}`;
  const cp = ev.cp ?? 0;
  return (cp >= 0 ? "+" : "") + (cp / 100).toFixed(1);
}

export default function EvalBar() {
  const [ev, setEv] = createSignal<Eval | null>(null);
  const [offline, setOffline] = createSignal(false);

  createEffect(() => {
    const f = fen();
    let cancelled = false;
    const t = setTimeout(() => {
      void analyse(f).then((res) => {
        if (cancelled) return;
        if (res === null) setOffline(true);
        else setEv(res);
      });
    }, 150);
    onCleanup(() => {
      cancelled = true;
      clearTimeout(t);
    });
  });

  return (
    <div class="eval-bar" title={offline() ? "engine offline" : "Stockfish (white POV)"}>
      <Show when={ev()} fallback={<div class="fill" style={{ height: "50%" }} />}>
        {(e) => (
          <>
            <div class="fill" style={{ height: `${pct(e())}%` }} />
            <div class="score">{offline() ? "—" : label(e())}</div>
          </>
        )}
      </Show>
    </div>
  );
}
