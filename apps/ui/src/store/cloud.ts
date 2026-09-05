import { createSignal, createEffect, onCleanup } from "solid-js";
import { cloudEval, type CloudEval } from "@chess-mcp/chess-tools";
import { fen } from "./game";
import { cloudEvalEnabled } from "./settings";

const [cloud, setCloud] = createSignal<CloudEval | null>(null);
export { cloud };

createEffect(() => {
  if (!cloudEvalEnabled()) {
    setCloud(null);
    return;
  }
  const f = fen();
  let cancelled = false;
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
