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

/**
 * A closed `<details>` still lays its content out — Chromium keeps it in a
 * `content-visibility: hidden` subtree whose descendants report non-empty client rects — so a
 * rect-based visibility test alone leaves unreachable controls in the candidate list, and
 * `.focus()` no-ops on them. Only a closed `<details>`'s own `<summary>` is reachable.
 */
const insideCollapsedDetails = (element: HTMLElement) => {
  const collapsed = element.closest("details:not([open])");
  if (collapsed === null) return false;
  return !(element.tagName === "SUMMARY" && element.parentElement === collapsed);
};

/**
 * macOS browsers do not give a `<button>` DOM focus when it is clicked — a platform convention
 * WebKit and Chrome both follow. A dialog opened by pointer therefore sees `document.activeElement`
 * as the body and has nothing to return focus to on close, which is a WCAG 2.4.3 failure that only
 * appears on macOS. Remembering the last pointer-activated control recovers exactly the
 * information that convention discards, without changing what the platform chooses to focus.
 *
 * Real evidence: run 32241021324's VoiceOver worker could not reopen the Settings dialog at all,
 * because closing it had left focus nowhere for Enter to act on.
 */
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

/** The control a dialog should return focus to when the platform did not focus its opener. */
function openerFallback(): HTMLElement | null {
  return lastPointerActivated?.isConnected === true ? lastPointerActivated : null;
}

/**
 * Open dialogs, outermost first.
 *
 * Every dialog listens on `document` in the capture phase, and capture listeners on one node run in
 * registration order — so the *outer* dialog hears Escape before the inner one. Without this stack,
 * opening a nested dialog and pressing Escape would close the outer dialog and leave the inner one
 * orphaned, which is the exact inverse of the expected behaviour. Only the topmost entry acts;
 * everything below it ignores the key entirely.
 */
const openDialogs: object[] = [];

/** True when `token` owns the current keyboard interaction. */
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
  /**
   * Render no title/description element and label the dialog from existing ids in `children`.
   * For surfaces that own a richer header than a plain title line.
   */
  labelledBy?: string;
  describedBy?: string;
  /** Replaces the default backdrop class rather than adding to it. */
  backdropClass?: string;
  /** Omit the `ui-dialog` presentation classes so `class` fully owns the surface's styling. */
  unstyled?: boolean;
  /** Suspends this dialog while a nested overlay is open. */
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
    // document.body is not a focus target: restoring to it is indistinguishable from restoring
    // nothing, and accepting it silently hides an opener that never took focus. macOS browsers do
    // not focus a <button> on click, so an opener that does not focus itself lands here as body.
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
          // Roving-tabindex members match button:not([disabled]) but are not Tab stops.
          element.getAttribute("tabindex") !== "-1" &&
          !insideCollapsedDetails(element),
      );
      // Native radio-group semantics: inputs sharing a name are one Tab stop (the checked radio,
      // or the first if none is checked). Arrow keys, still native, move within the group.
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
      // A nested dialog owns the keyboard: this outer listener registered first, so without the
      // stack check it would answer Escape on the inner dialog's behalf and close the wrong one.
      if (!isTopmost(token)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        // stopImmediatePropagation, not stopPropagation: every open dialog installs its own
        // capture-phase listener on `document`, and stopPropagation does not stop other listeners
        // already attached to that same node. With a nested dialog, one Escape would close both.
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
      // Always move focus explicitly, not only at the wrap boundary. macOS ships Safari's "Full
      // Keyboard Access" off by default, which makes native Tab skip <button> entirely — a real
      // user-facing trap, caught by real VoiceOver CI evidence against this trap's extraction
      // source and fixed there in 85b3e2a before it could be extracted here.
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
      // Re-assert across the next frames rather than restoring once: WebKit resets focus to the
      // body *after* this cleanup, because the element that held focus was inside the dialog just
      // removed, so a single restore lands and is then wiped.
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
