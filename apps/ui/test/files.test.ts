import assert from "node:assert/strict";
import test from "node:test";
import { actions } from "../src/store/game.ts";

import {
  cancelDocumentClose,
  continueDocumentClose,
  pendingDocumentClose,
  requestDocumentClose,
} from "../src/store/files.ts";

test("document-close resume runs at most once", async () => {
  cancelDocumentClose();
  actions.newGame();
  actions.play("e2", "e4");
  let resumes = 0;

  requestDocumentClose("new", () => {
    resumes += 1;
  });
  requestDocumentClose("open", () => {
    resumes += 100;
  });
  const first = continueDocumentClose();
  const second = continueDocumentClose();
  await Promise.all([first, second]);

  assert.equal(resumes, 1);
  assert.equal(pendingDocumentClose(), null);
});

test("clean document replacement resumes immediately without a modal", () => {
  cancelDocumentClose();
  actions.newGame();
  let resumes = 0;
  requestDocumentClose("open", () => {
    resumes++;
  });
  assert.equal(resumes, 1);
  assert.equal(pendingDocumentClose(), null);
});
