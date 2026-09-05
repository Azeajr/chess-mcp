import { For, Show } from "solid-js";
import { runningOperations } from "../store/operations";

export default function ActivityStrip() {
  return (
    <Show when={runningOperations().length > 0}>
      <div class="activity-strip" role="status">
        <For each={runningOperations()}>
          {(operation) => (
            <div class="activity-strip-item">
              <span>{operation.label} running…</span>
              <Show when={operation.cancel}>
                {(cancel) => (
                  <button
                    type="button"
                    onClick={() => {
                      cancel()();
                    }}
                  >
                    Cancel
                  </button>
                )}
              </Show>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
