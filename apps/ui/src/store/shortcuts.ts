type ShortcutHandler = (event: KeyboardEvent) => void;
export interface ShortcutRegistration {
  id: string;
  key: string;
  handler: ShortcutHandler;
  allowInTextFields?: boolean;
}

const registrations: ShortcutRegistration[] = [];
const scopes: string[] = [];

export function registerShortcut(registration: ShortcutRegistration): () => void {
  registrations.push(registration);
  return () => {
    const index = registrations.indexOf(registration);
    if (index >= 0) registrations.splice(index, 1);
  };
}

export function pushShortcutScope(name: string): () => void {
  scopes.push(name);
  return () => {
    const index = scopes.lastIndexOf(name);
    if (index >= 0) scopes.splice(index, 1);
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
  if (registration.key.length === 1 && !(event.metaKey || event.ctrlKey)) return false;
  return registration.key.length !== 1 || event.metaKey || event.ctrlKey;
}

export function dispatchShortcut(event: KeyboardEvent): boolean {
  if (scopes.length > 0) return false;
  const registration = registrations.find(
    (candidate) =>
      matches(event, candidate) &&
      (candidate.allowInTextFields === true ? true : !isTextField(event.target)),
  );
  if (!registration) return false;
  event.preventDefault();
  registration.handler(event);
  return true;
}

export function clearShortcutsForTests(): void {
  registrations.length = 0;
  scopes.length = 0;
}
