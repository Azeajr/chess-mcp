/**
 * Lichess cloud eval for the current position — a free second opinion alongside local Stockfish.
 * Debounced and offline-safe (null on miss/offline). Rate limiting lives in chess-tools/apiclient.
 */
import { createSignal, createEffect, onCleanup } from "solid-js";
import { cloudEval, type CloudEval } from "@chess-mcp/chess-tools";
import { fen } from "./game";

const [cloud, setCloud] = createSignal<CloudEval | null>(null);
export { cloud };

createEffect(() => {
  const f = fen();
  let cancelled = false;
  // Generous debounce: cloud eval is a nicety, and the limiter caps us at ~1 req/s anyway.
  const t = setTimeout(() => {
    void cloudEval(f).then((res) => {
      if (!cancelled) setCloud(res);
    });
  }, 600);
  onCleanup(() => {
    cancelled = true;
    clearTimeout(t);
  });
});
