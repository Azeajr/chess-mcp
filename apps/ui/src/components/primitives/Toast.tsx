/**
 * WP-009 — the single reusable Toast primitive. A transient, dismissible, optionally actioned
 * notice anchored bottom-centre (safe-area aware) that mirrors its message through `announce()`
 * so the live regions and the visual toast never diverge. WP-005, WP-018, and WP-019 consume
 * this same primitive; they own when to show it, this component owns how it behaves.
 *
 * Auto-dismisses after 8 s unless it carries an action — an actionable toast needs the user's
 * decision, not a timer. Persistent state display still belongs in a panel, not here.
 */
import { Show, onCleanup, onMount, type JSX } from "solid-js";
import { announce } from "../../store/announce";

export interface ToastAction {
  readonly label: string;
  readonly onClick: () => void;
}

export interface ToastProps {
  readonly message: string;
  /** Errors render with the danger tone and announce assertively. */
  readonly tone?: "neutral" | "success" | "danger";
  readonly action?: ToastAction;
  readonly onDismiss: () => void;
  /**
   * Mirror the message through announce() so the live regions match the visual toast.
   * Pass false when the same event is ALREADY announced elsewhere (e.g. the WP-010 operation
   * registry announces every operation start and settle) — a double announcement violates the
   * WP-009 exactly-one-message-per-event policy.
   */
  readonly mirrorToLiveRegion?: boolean;
}

const AUTO_DISMISS_MS = 8_000;

export default function Toast(props: ToastProps): JSX.Element {
  const dismiss = () => {
    props.onDismiss();
  };
  // Mirroring happens on mount, once per shown toast — not reactively on every prop change.
  onMount(() => {
    if (props.mirrorToLiveRegion !== false) {
      announce(props.message, { assertive: props.tone === "danger" });
    }
    if (props.action === undefined) {
      const timer = setTimeout(() => {
        dismiss();
      }, AUTO_DISMISS_MS);
      onCleanup(() => {
        clearTimeout(timer);
      });
    }
  });

  return (
    <div class={`ui-toast ui-toast-${props.tone ?? "neutral"}`} role="presentation">
      <span class="ui-toast-message">{props.message}</span>
      <Show when={props.action}>
        {(action) => (
          <button
            class="ui-toast-action"
            onClick={() => {
              action().onClick();
              dismiss();
            }}
          >
            {action().label}
          </button>
        )}
      </Show>
      <button
        class="ui-toast-dismiss"
        aria-label="Dismiss notification"
        onClick={() => {
          dismiss();
        }}
      >
        ×
      </button>
    </div>
  );
}
