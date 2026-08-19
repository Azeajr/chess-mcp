import { Show, createSignal } from "solid-js";
import { pendingLoad, resolvePendingLoad, cancelPendingLoad, loadError } from "../store/files";
import type { Color } from "../store/game";
import Dialog from "./primitives/Dialog";

export default function ColorPickerModal() {
  return (
    <Show when={pendingLoad()}>
      {(p) => {
        const [sel, setSel] = createSignal<Color>(p().detectedColor ?? "white");
        return (
          <Dialog
            title="Which color is this repertoire for?"
            class="color-picker-modal"
            dismissOnBackdrop={false}
            initialFocus=".color-btn"
            onClose={cancelPendingLoad}
          >
            <Show when={p().name}>
              <div class="color-picker-file">{p().name}</div>
            </Show>
            <div class="color-picker-buttons">
              <button
                class={`color-btn${sel() === "white" ? " active" : ""}`}
                onClick={() => setSel("white")}
              >
                {/* solid glyph for both (outline ♔ tofus in some fonts); CSS tints this white */}
                <span class="color-piece color-piece-white" aria-hidden="true">
                  ♚
                </span>{" "}
                White
              </button>
              <button
                class={`color-btn${sel() === "black" ? " active" : ""}`}
                onClick={() => setSel("black")}
              >
                <span class="color-piece" aria-hidden="true">
                  ♚
                </span>{" "}
                Black
              </button>
            </div>
            <Show when={p().detectedColor}>
              <div class="color-picker-hint">Detected from file headers</div>
            </Show>
            <Show when={loadError()}>
              <div class="color-picker-error">Could not load: {loadError()}</div>
            </Show>
            <div class="color-picker-actions">
              <button
                class="color-picker-load"
                onClick={() => {
                  resolvePendingLoad(sel());
                }}
              >
                Load
              </button>
              <button class="color-picker-cancel" onClick={cancelPendingLoad}>
                Cancel
              </button>
            </div>
          </Dialog>
        );
      }}
    </Show>
  );
}
