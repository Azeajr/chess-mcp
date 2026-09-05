import { createSignal } from "solid-js";

type ShortcutHandler = (event: KeyboardEvent) => void;

export interface ShortcutRegistration {
  readonly id: string;
  readonly key: string;
  readonly handler: ShortcutHandler;
  readonly allowInTextFields?: boolean;
}

const registrations: ShortcutRegistration[] = [];
const scopes: string[] = [];
const [scopeDepth, setScopeDepth] = createSignal(0);

export const backgroundSuspended = () => scopeDepth() > 0;

export function registerShortcut(registration: ShortcutRegistration): () => void {
  registrations.push(registration);
  return () => {
    const index = registrations.indexOf(registration);
    if (index >= 0) registrations.splice(index, 1);
  };
}

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
