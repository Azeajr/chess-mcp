import { Show, createSignal } from "solid-js";
import { pendingLoad, resolvePendingLoad, cancelPendingLoad, loadError } from "../store/files";
import type { Color } from "../store/game";

export default function ColorPickerModal() {
  return (
    <Show when={pendingLoad()}>
      {(p) => {
        const [sel, setSel] = createSignal<Color>(p().detectedColor ?? "white");
        return (
          <div class="color-picker-backdrop" onClick={cancelPendingLoad}>
            <div class="color-picker-modal" onClick={(e) => e.stopPropagation()}>
              <div class="color-picker-title">Which color is this repertoire for?</div>
              <Show when={p().name}>
                <div class="color-picker-file">{p().name}</div>
              </Show>
              <div class="color-picker-buttons">
                <button
                  class={`color-btn${sel() === "white" ? " active" : ""}`}
                  onClick={() => setSel("white")}
                >
                  {/* solid glyph for both (outline ♔ tofus in some fonts); CSS tints this white */}
                  <span class="color-piece color-piece-white" aria-hidden="true">♚</span> White
                </button>
                <button
                  class={`color-btn${sel() === "black" ? " active" : ""}`}
                  onClick={() => setSel("black")}
                >
                  <span class="color-piece" aria-hidden="true">♚</span> Black
                </button>
              </div>
              <Show when={p().detectedColor}>
                <div class="color-picker-hint">Detected from file headers</div>
              </Show>
              <Show when={loadError()}>
                <div class="color-picker-error">Could not load: {loadError()}</div>
              </Show>
              <div class="color-picker-actions">
                <button class="color-picker-load" onClick={() => resolvePendingLoad(sel())}>
                  Load
                </button>
                <button class="color-picker-cancel" onClick={cancelPendingLoad}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      }}
    </Show>
  );
}
