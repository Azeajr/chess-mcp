/**
 * WP-013 — names whatever is running behind the currently-hidden mobile tabs, with a cancel
 * control, so switching tabs never makes a running operation invisible. Phone-tier only: this is
 * the same tier `MobileTabs` itself is scoped to (`.mobile-tabs` is `display: none` above the
 * 45em/720px breakpoint), and there is no acceptance test or density bound covering a wide-tier
 * placement, so this package does not add one.
 */
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
