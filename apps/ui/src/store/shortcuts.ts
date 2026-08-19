import { createSignal } from "solid-js";

/**
 * One place that decides whether a global document shortcut may fire, and one refcount for
 * "something is layered over the app". Those are the same fact, so they share a stack rather than
 * being tracked twice: an overlay pushes a scope, and the background is inert exactly while the
 * stack is non-empty. Tracking them separately is how a background can end up interactive behind a
 * dialog, or inert after every dialog has closed.
 */
type ShortcutHandler = (event: KeyboardEvent) => void;

export interface ShortcutRegistration {
  readonly id: string;
  /** A single character means "requires Cmd/Ctrl"; a named key such as ArrowLeft stands alone. */
  readonly key: string;
  readonly handler: ShortcutHandler;
  /** Only for shortcuts nothing else claims while typing — Cmd/Ctrl+S, not Cmd/Ctrl+Z. */
  readonly allowInTextFields?: boolean;
}

const registrations: ShortcutRegistration[] = [];
const scopes: string[] = [];
const [scopeDepth, setScopeDepth] = createSignal(0);

/** True while any overlay is layered over the app, so the background must be inert and hidden. */
export const backgroundSuspended = () => scopeDepth() > 0;

export function registerShortcut(registration: ShortcutRegistration): () => void {
  registrations.push(registration);
  return () => {
    const index = registrations.indexOf(registration);
    if (index >= 0) registrations.splice(index, 1);
  };
}

/**
 * Suspends global shortcuts and marks the background inert until the returned disposer runs.
 * Removes this scope's own entry rather than the top of the stack, so overlays closing out of
 * order (a nested dialog outliving its parent) cannot leave the count stranded above zero.
 */
export function pushShortcutScope(name: string): () => void {
  const entry = `${name}:${scopes.length}:${Math.random()}`;
  scopes.push(entry);
  setScopeDepth(scopes.length);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const index = scopes.indexOf(entry);
    if (index >= 0) scopes.splice(index, 1);
    setScopeDepth(scopes.length);
  };
}

function isTextField(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  return (
    (typeof HTMLInputElement !== "undefined" && target instanceof HTMLInputElement) ||
    (typeof HTMLTextAreaElement !== "undefined" && target instanceof HTMLTextAreaElement) ||
    (typeof HTMLSelectElement !== "undefined" && target instanceof HTMLSelectElement) ||
    target.isContentEditable
  );
}

function matches(event: KeyboardEvent, registration: ShortcutRegistration): boolean {
  if (event.key.toLowerCase() !== registration.key.toLowerCase()) return false;
  if (registration.key.length !== 1) return true;
  return event.metaKey || event.ctrlKey;
}

/** Returns true when a registration claimed the event, so the caller knows it was handled. */
export function dispatchShortcut(event: KeyboardEvent): boolean {
  if (scopes.length > 0) return false;
  const registration = registrations.find(
    (candidate) =>
      matches(event, candidate) &&
      ((candidate.allowInTextFields ?? false) || !isTextField(event.target)),
  );
  if (!registration) return false;
  event.preventDefault();
  registration.handler(event);
  return true;
}

export function clearShortcutsForTests(): void {
  registrations.length = 0;
  scopes.length = 0;
  setScopeDepth(0);
}
