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

const insideCollapsedDetails = (element: HTMLElement) => {
  const collapsed = element.closest("details:not([open])");
  if (collapsed === null) return false;
  return !(element.tagName === "SUMMARY" && element.parentElement === collapsed);
};

let lastPointerActivated: HTMLElement | null = null;
if (typeof document !== "undefined") {
  document.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target;
      lastPointerActivated =
        target instanceof HTMLElement
          ? target.closest<HTMLElement>("button, a[href], [tabindex]:not([tabindex='-1'])")
          : null;
    },
    true,
  );
}

function openerFallback(): HTMLElement | null {
  return lastPointerActivated?.isConnected === true ? lastPointerActivated : null;
}

const openDialogs: object[] = [];

function isTopmost(token: object): boolean {
  return openDialogs.at(-1) === token;
}

export interface DialogProps {
  title: string;
  description?: string;
  size?: "drawer" | "compact";
  dismissOnBackdrop?: boolean;
  initialFocus?: string;
  class?: string;
  children: JSX.Element;
  onClose: () => void;
  labelledBy?: string;
  describedBy?: string;
  backdropClass?: string;
  unstyled?: boolean;
  inert?: boolean;
}

export default function Dialog(props: DialogProps) {
  let dialog!: HTMLElement;
  let returnFocus: HTMLElement | null = null;
  const titleId = `dialog-title-${nextDialogId++}`;
  const descriptionId = `dialog-description-${nextDialogId++}`;

  onMount(() => {
    const token = {};
    openDialogs.push(token);
    const activeOnOpen = document.activeElement;
    const focusedOpener =
      activeOnOpen instanceof HTMLElement && activeOnOpen !== document.body ? activeOnOpen : null;
    returnFocus = focusedOpener ?? openerFallback();

    const disposeScope = pushShortcutScope("modal");
    const focusable = () => {
      const raw = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) =>
          element.getClientRects().length > 0 &&
          element.getAttribute("aria-hidden") !== "true" &&
          element.getAttribute("tabindex") !== "-1" &&
          !insideCollapsedDetails(element),
      );
      const groupRepresentative = new Map<string, HTMLInputElement>();
      for (const element of raw) {
        if (!(element instanceof HTMLInputElement) || element.type !== "radio" || !element.name)
          continue;
        if (element.checked || !groupRepresentative.has(element.name)) {
          groupRepresentative.set(element.name, element);
        }
      }
      return raw.filter((element) => {
        if (!(element instanceof HTMLInputElement) || element.type !== "radio" || !element.name)
          return true;
        return groupRepresentative.get(element.name) === element;
      });
    };

    const focusInitial = () => {
      const target = props.initialFocus
        ? dialog.querySelector<HTMLElement>(props.initialFocus)
        : null;
      (target ?? focusable()[0] ?? dialog).focus();
    };

    const trapFocus = (event: KeyboardEvent) => {
      if (!isTopmost(token)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
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
      const active = document.activeElement;
      const activeIndex = candidates.findIndex((element) => element === active);
      event.preventDefault();
      if (event.shiftKey) {
        const prevIndex = activeIndex <= 0 ? candidates.length - 1 : activeIndex - 1;
        candidates[prevIndex]?.focus();
      } else {
        const nextIndex =
          activeIndex === -1 || activeIndex === candidates.length - 1 ? 0 : activeIndex + 1;
        candidates[nextIndex]?.focus();
      }
    };

    document.addEventListener("keydown", trapFocus, true);
    requestAnimationFrame(focusInitial);
    onCleanup(() => {
      const index = openDialogs.indexOf(token);
      if (index !== -1) openDialogs.splice(index, 1);
      document.removeEventListener("keydown", trapFocus, true);
      disposeScope();
      const restoreFocus = (attemptsLeft: number) => {
        const target = returnFocus;
        if (!target?.isConnected) return;
        if (document.activeElement !== target) target.focus();
        if (attemptsLeft > 0) {
          requestAnimationFrame(() => {
            restoreFocus(attemptsLeft - 1);
          });
        }
      };
      queueMicrotask(() => {
        restoreFocus(2);
      });
    });
  });

  return (
    <div
      class={
        props.backdropClass ??
        `ui-dialog-backdrop${props.size === "drawer" ? " ui-dialog-backdrop-drawer" : ""}`
      }
      onClick={(event) => {
        if (props.dismissOnBackdrop && event.target === event.currentTarget) props.onClose();
      }}
    >
      <section
        ref={dialog}
        class={
          props.unstyled
            ? (props.class ?? "")
            : `ui-dialog ui-dialog-${props.size ?? "compact"}${props.class ? ` ${props.class}` : ""}`
        }
        role="dialog"
        aria-modal="true"
        inert={props.inert}
        aria-hidden={props.inert ? "true" : undefined}
        aria-labelledby={props.labelledBy ?? titleId}
        aria-describedby={props.describedBy ?? (props.description ? descriptionId : undefined)}
        tabIndex={-1}
      >
        {/* h1, not h2: a dialog root is its own heading outline, and the accessibility contract
            checks that each root's visible outline starts at h1 — the same reason the Strategic
            Fit workspace titles itself with an h1. A surface passing labelledBy renders its own
            heading with that id instead. */}
        {props.labelledBy ? null : (
          <h1 id={titleId} class="ui-dialog-title">
            {props.title}
          </h1>
        )}
        {props.description && !props.describedBy ? (
          <p id={descriptionId} class="ui-dialog-description">
            {props.description}
          </p>
        ) : null}
        {props.children}
      </section>
    </div>
  );
}
