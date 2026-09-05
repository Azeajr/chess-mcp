import { Show, onCleanup, onMount, type JSX } from "solid-js";
import { announce } from "../../store/announce";

interface ToastAction {
  readonly label: string;
  readonly onClick: () => void;
}

export interface ToastProps {
  readonly message: string;
  readonly tone?: "neutral" | "success" | "danger";
  readonly action?: ToastAction;
  readonly onDismiss: () => void;
  readonly dismissLabel?: string;
  readonly mirrorToLiveRegion?: boolean;
}

const AUTO_DISMISS_MS = 8_000;

export default function Toast(props: ToastProps): JSX.Element {
  const dismiss = () => {
    props.onDismiss();
  };
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
        class={`ui-toast-dismiss${props.dismissLabel ? " ui-toast-dismiss-labelled" : ""}`}
        aria-label={props.dismissLabel ?? "Dismiss notification"}
        onClick={() => {
          dismiss();
        }}
      >
        {props.dismissLabel ?? "×"}
      </button>
    </div>
  );
}
