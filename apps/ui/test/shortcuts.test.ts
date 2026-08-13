import assert from "node:assert/strict";
import test from "node:test";
import {
  clearShortcutsForTests,
  dispatchShortcut,
  pushShortcutScope,
  registerShortcut,
} from "../src/store/shortcuts.ts";

function keyEvent(key: string, modifiers: { ctrlKey?: boolean; metaKey?: boolean } = {}) {
  let prevented = false;
  return {
    key,
    ctrlKey: modifiers.ctrlKey ?? false,
    metaKey: modifiers.metaKey ?? false,
    target: null,
    preventDefault: () => {
      prevented = true;
    },
    get prevented() {
      return prevented;
    },
  } as unknown as KeyboardEvent & { readonly prevented: boolean };
}

test("shortcut scopes suspend registered commands without blocking native dialog keys", () => {
  clearShortcutsForTests();
  let forwards = 0;
  const dispose = registerShortcut({
    id: "position.forward",
    key: "ArrowRight",
    handler: () => {
      forwards += 1;
    },
  });

  const active = keyEvent("ArrowRight");
  assert.equal(dispatchShortcut(active), true);
  assert.equal(active.prevented, true);
  assert.equal(forwards, 1);

  const releaseScope = pushShortcutScope("modal");
  const scoped = keyEvent("ArrowRight");
  assert.equal(dispatchShortcut(scoped), false);
  assert.equal(scoped.prevented, false);
  assert.equal(forwards, 1);

  releaseScope();
  dispose();
  clearShortcutsForTests();
});
