import assert from "node:assert/strict";
import test from "node:test";
import {
  backgroundSuspended,
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

test("out-of-order scope disposal cannot strand the background suspended", () => {
  clearShortcutsForTests();
  assert.equal(backgroundSuspended(), false);
  const releaseOuter = pushShortcutScope("workspace");
  const releaseInner = pushShortcutScope("modal");
  assert.equal(backgroundSuspended(), true);

  // The outer overlay disposing first is the nested-dialog case that corrupted the background in
  // the extraction source: a stack that pops blindly would drop the inner scope's entry here.
  releaseOuter();
  assert.equal(backgroundSuspended(), true);
  releaseInner();
  assert.equal(backgroundSuspended(), false);

  // Disposing twice is a no-op rather than a decrement, so a double cleanup cannot unsuspend a
  // background that another overlay still owns.
  releaseInner();
  assert.equal(backgroundSuspended(), false);
  clearShortcutsForTests();
});

test("single-character shortcuts require Cmd/Ctrl and named keys stand alone", () => {
  clearShortcutsForTests();
  let saves = 0;
  registerShortcut({
    id: "document.save",
    key: "s",
    allowInTextFields: true,
    handler: () => {
      saves += 1;
    },
  });

  assert.equal(dispatchShortcut(keyEvent("s")), false);
  assert.equal(saves, 0);
  assert.equal(dispatchShortcut(keyEvent("s", { ctrlKey: true })), true);
  assert.equal(dispatchShortcut(keyEvent("s", { metaKey: true })), true);
  assert.equal(saves, 2);
  clearShortcutsForTests();
});
