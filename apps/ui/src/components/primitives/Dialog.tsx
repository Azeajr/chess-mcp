import { onCleanup, onMount, type JSX } from "solid-js";
import { pushShortcutScope } from "../../store/shortcuts";

let nextDialogId = 0;

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export interface DialogProps {
  title: string;
  description?: string;
  size?: "drawer" | "compact";
  dismissOnBackdrop?: boolean;
  initialFocus?: string;
  class?: string;
  children: JSX.Element;
  onClose: () => void;
}

export default function Dialog(props: DialogProps) {
  let dialog!: HTMLElement;
  let returnFocus: HTMLElement | null = null;
  const titleId = `dialog-title-${nextDialogId++}`;
  const descriptionId = `dialog-description-${nextDialogId++}`;

  onMount(() => {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const appMain = document.querySelector<HTMLElement>(".app-main");
    const previousInert = appMain?.inert ?? false;
    const previousAriaHidden = appMain ? appMain.getAttribute("aria-hidden") : null;
    if (appMain) {
      appMain.inert = true;
      appMain.setAttribute("aria-hidden", "true");
    }

    const disposeScope = pushShortcutScope("modal");
    const focusable = () =>
      [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) =>
          element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true",
      );
    const focusInitial = () => {
      const target = props.initialFocus
        ? dialog.querySelector<HTMLElement>(props.initialFocus)
        : null;
      (target ?? focusable()[0] ?? dialog).focus();
    };
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        props.onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const candidates = focusable();
      if (candidates.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = candidates.at(0);
      if (first === undefined) return;
      const last = candidates.at(-1) ?? first;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", trapFocus, true);
    requestAnimationFrame(focusInitial);
    onCleanup(() => {
      document.removeEventListener("keydown", trapFocus, true);
      disposeScope();
      if (appMain) {
        appMain.inert = previousInert;
        if (previousAriaHidden === null) appMain.removeAttribute("aria-hidden");
        else appMain.setAttribute("aria-hidden", previousAriaHidden);
      }
      queueMicrotask(() => {
        if (returnFocus?.isConnected) returnFocus.focus();
      });
    });
  });

  return (
    <div
      class={`ui-dialog-backdrop${props.size === "drawer" ? " ui-dialog-backdrop-drawer" : ""}`}
      onClick={(event) => {
        if (props.dismissOnBackdrop && event.target === event.currentTarget) props.onClose();
      }}
    >
      <section
        ref={dialog}
        class={`ui-dialog ui-dialog-${props.size ?? "compact"}${props.class ? ` ${props.class}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={props.description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <h2 id={titleId} class="ui-dialog-title">
          {props.title}
        </h2>
        {props.description ? (
          <p id={descriptionId} class="ui-dialog-description">
            {props.description}
          </p>
        ) : null}
        {props.children}
      </section>
    </div>
  );
}
